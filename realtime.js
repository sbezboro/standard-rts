var http = require('http')
  , express = require('express')
  , bodyParser = require('body-parser')
  , socketio = require('socket.io')
  , request = require('request')
  , rollbar = require('rollbar')
  , events = require('events')
  , crypto = require('crypto')
  , StatsD = require('node-statsd')
  , config = require('./config')
  , logger = require('./logger')
  , jsonapi = require('./jsonapi')
  , streams = require('./streams')
  , consoleServer = require('./sockets/console')
  , chatServer = require('./sockets/chat')
  , internalApi = require('./internalapi')
  , util = require('./util');

var app = null;
var io = null;
var apis = {};
var stats = null;

var connections = {};

var serverStatus = {};

var isUserConnected = function(uuid) {
  var id;
  for (id in connections) {
    if (!connections.hasOwnProperty(id)) {
      continue;
    }

    var connection = connections[id];
    if (connection.uuid === uuid) {
      return true;
    }
  }
  return false;
};

var initUserChannel = function() {
  io
  .of('/user')
  .on('connection', function(socket) {
    socket.on('auth', function(data) {
      socket.removeAllListeners('auth');
      exports.authorize(socket, data, false, false, function(err, userId, username, uuid, isSuperuser, isModerator) {
        if (err) {
          console.log(err);
          return;
        }

        if (userId) {
          socket.join(userId);

          internalApi.rtsUserConnection(userId);
        }
      });
    });
  });
};

var initServerStatusGetter = function(serverId) {
  var api = apis[serverId];

  var getter = function() {
    api.call('server_status', {minimal: true}, function(error, data) {
      if (error || !data) {
        logger.error('Error getting server status for server ' + serverId + ': ' + error);
      } else {
        data = data.data;

        if (data && data.players) {
          for (var i = 0; i < data.players.length; ++i) {
            var nicknameAnsi = data.players[i].nickname_ansi;
            if (nicknameAnsi) {
              // Add '0;' after every '[' to fix html span generation, otherwise all spans are nested
              var fixedNicknameAnsi = nicknameAnsi.replace(/\[3/g, '[0;3');

              data.players[i].nicknameAnsi = util.ansiConvert.toHtml(fixedNicknameAnsi);
              delete data.players[i].nickname_ansi;
            }
          }

          serverStatus[serverId] = {
            players: data.players,
            numPlayers: data.numplayers,
            maxPlayers: data.maxplayers,
            load: data.load,
            tps: data.tps
          };

          stats.gauge('minecraft.server.' + serverId + '.players.count', data.numplayers);
          stats.gauge('minecraft.server.' + serverId + '.players.max', data.maxplayers);
          stats.gauge('minecraft.server.' + serverId + '.tps', data.tps);
        }
      }

      setTimeout(getter, 2000);
    });
  };

  getter();
};

var generateAuthToken = function(content) {
  var hash = crypto.createHmac('sha256', config.authSecret);
  return hash.update(content).digest('hex');
};

exports.authorize = function(socket, data, elevated, allowAnonymous, callback) {
  var authData = data.authData;
  if (authData && authData.token) {
    var userId = authData.user_id;
    var username = authData.username;
    var uuid = authData.uuid;
    var isSuperuser = authData.is_superuser;
    var isModerator = authData.is_moderator;
    var token = authData.token;

    var content = [userId, username, uuid, isSuperuser, isModerator].join('-');

    var checkToken = generateAuthToken(content);

    if (token === checkToken && (!elevated || isSuperuser)) {
      socket.emit('authorized');
      return callback(null, userId, username, uuid, isSuperuser, isModerator);
    } else {
      return socket.emit('unauthorized');
    }
  } else if (allowAnonymous) {
    socket.emit('authorized');
    return callback(null);
  } else {
    return socket.emit('unauthorized');
  }
};

exports.addConnection = function(socket, type) {
  var address = 'unknown';
  if (socket.handshake) {
    address = socket.handshake.headers['x-real-ip'] || socket.handshake.address.address;
  }

  var unique = true;

  var userId = socket.userId;
  var username = socket.username;
  var uuid = socket.uuid;

  var connection = {
    connectionTime: Math.round(Date.now() / 1000),
    lastActive: Math.round(Date.now() / 1000),
    address: address,
    type: type,
    socketId: socket.id,
    active: true
  };

  if (userId) {
    connection.userId = userId;
    connection.username = username;
    connection.uuid = uuid;

    unique = !isUserConnected(uuid);

    internalApi.getPlayerData(userId, function(err, data) {
      if (!err) {
        var key;
        for (key in data) {
          if (data.hasOwnProperty(key)) {
            connection[key] = data[key];
          }
        }
      }
    });
  }

  connections[socket.id] = connection;

  return unique;
};

exports.removeConnection = function(socket) {
  var unique = true;

  var connection = connections[socket.id];
  delete connections[socket.id];

  var uuid = connection.uuid;
  if (uuid) {
    unique = !isUserConnected(uuid);
  }

  return unique;
};

var insertActiveWebChatUser = function(connection, redactAddress, users, callback) {
  var user = {
    active: connection.active,
    username: connection.username,
    uuid: connection.uuid
  };

  if (connection.nickname) {
    user.nickname = connection.nickname;
  }

  if (!redactAddress) {
    user.address = connection.address;
  }

  users.push(user);

  callback();
};

exports.getActiveWebChatUsers = function(redactAddress, callback) {
  var userMap = {};
  var validConnections = [];

  var id;
  for (id in connections) {
    if (!connections.hasOwnProperty(id)) {
      continue;
    }

    var connection = connections[id];
    if (connection.type == 'chat' && connection.username && connection.uuid && !connection.banned &&
        !userMap[connection.username]) {
      userMap[connection.username] = true;
      validConnections.push(connection);
    }
  }

  var i;
  var inserted = 0;
  var result = [];

  if (validConnections.length) {
    for (i = 0; i < validConnections.length; ++i) {
      insertActiveWebChatUser(validConnections[i], redactAddress, result, function (err) {
        if (++inserted == validConnections.length) {
          callback(null, result);
        }
      });
    }
  } else {
    callback(null, result);
  }
};

exports.init = function(callback) {
  app = express();
  app.use(bodyParser.json());

  app.get('/users', function(req, res) {
    exports.getActiveWebChatUsers(true, function(err, users) {
      res.send({
        users: users
      });
    });
  });

  app.post('/event/user', function (req, res) {
    var secret = req.headers['x-standard-secret'];

    if (secret !== config.authSecret) {
      return res.status(403).send({
        'err': 'Unauthorized'
      });
    }

    var data = req.body;

    io.of('user').in(data.user_id).emit(data.action, data.payload);

    res.send({});
  });

  stats = new StatsD(config.statsd);
  
  if (config.rollbar) {
    rollbar.init(config.rollbar.accessToken, {
      environment: config.rollbar.environment,
      root: config.rollbar.root,
      branch: config.rollbar.branch
    });
    
    if (!config.debug) {
      rollbar.handleUncaughtExceptions();
    }
  }

  internalApi.getServers(function(err, data) {
    if (err) {
      return callback(err);
    }

    var i;
    for (i = 0; i < data.servers.length; ++i) {
      var server = data.servers[i];

      if (!server.online) {
        continue;
      }

      var id = server.id;
      var address = server.address;

      apis[id] = new jsonapi.JSONAPI({
        hostname: address,
        port: config.mcApiPort,
        username: config.mcApiUsername,
        password: config.mcApiPassword,
        salt: config.mcApiSalt
      });

      initServerStatusGetter(id);
    }

    setInterval(function() {
      stats.gauge('rts.connections.count', Object.keys(connections).length);
    }, 5000);

    return callback();
  });
};

exports.start = function() {
  var server = app.listen(config.port);
  io = socketio.listen(server);
  
  streams.startStreams();
  
  consoleServer.start(io, apis);
  chatServer.start(io, apis);

  initUserChannel();
};

exports.config = config;
exports.apis = apis;
exports.connections = connections;
exports.serverStatus = serverStatus;
