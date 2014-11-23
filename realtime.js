var http = require('http')
  , express = require('express')
  , bodyParser = require('body-parser')
  , socketio = require('socket.io')
  , request = require('request')
  , rollbar = require('rollbar')
  , events = require('events')
  , crypto = require('crypto')
  , logger = require('./logger')
  , jsonapi = require('./jsonapi')
  , streams = require('./streams')
  , consoleServer = require('./sockets/console')
  , chatServer = require('./sockets/chat')
  , util = require('./util');

var app = null;
var io = null;
var config = null;
var apis = {};

var connections = {};

var serverStatus = {};

var isUserConnected = function(username) {
  var id;
  for (id in connections) {
    if (!connections.hasOwnProperty(id)) {
      continue;
    }

    var connection = connections[id];
    if (connection.username === username) {
      return true;
    }
  }
  return false;
};

var setupUserEndpoint = function(endpoint) {
  io
  .of('/' + endpoint)
  .on('connection', function(socket) {
    socket.on('auth', function(data) {
      socket.removeAllListeners('auth');
      exports.authorize(socket, data, false, false, function(err, userId, username, uuid) {
        if (err) {
          console.log(err);
          return;
        }

        if (userId) {
          socket.join(userId);
        }
      });
    });
  });

  app.post('/' + endpoint, function (req, res) {
    var secret = req.headers['x-standard-secret'];

    if (secret !== config.authSecret) {
      return res.status(403).send({
        'err': 'Unauthorized'
      });
    }

    var data = req.body;

    io.of(endpoint).in(data.user_id).emit(data.action, data.payload);

    res.send({});
  });
};

var initServerStatusGetter = function(serverId) {
  var api = apis[serverId];

  var getter = function() {
    api.call('server_status', function(error, data) {
      if (error || !data) {
        logger.error('Error getting server status for server ' + serverId + ': ' + error);
      } else {
        data = data.data;

        if (data && data.players) {
          for (var i = 0; i < data.players.length; ++i) {
            var nicknameAnsi = data.players[i].nickname_ansi;
            if (nicknameAnsi) {
              data.players[i].nicknameAnsi = util.ansiConvert.toHtml(nicknameAnsi);
            }
          }

          serverStatus[serverId] = {
            players: data.players,
            numPlayers: data.numplayers,
            maxPlayers: data.maxplayers,
            load: data.load,
            tps: data.tps
          };
        }
      }

      setTimeout(getter, 1000);
    });
  };

  getter();
};

var generateAuthToken = function(content) {
  var shasum = crypto.createHash('sha256');
  return shasum.update(content + config.authSecret).digest('hex');
};

exports.authorize = function(socket, data, elevated, allowAnonymous, callback) {
  var authData = data.authData;
  if (authData && authData.token) {
    var userId = authData.user_id;
    var username = authData.username;
    var uuid = authData.uuid;
    var isSuperuser = authData.is_superuser;
    var token = authData.token;

    var content = [userId, username, uuid, isSuperuser].join('-');

    var checkToken = generateAuthToken(content);

    if (token === checkToken && (!elevated || isSuperuser)) {
      socket.emit('authorized');
      return callback(null, userId, username, uuid);
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
    connectionTime: Math.floor(new Date().getTime() / 1000),
    address: address,
    type: type,
    socketId: socket.id,
    active: true
  };

  if (userId) {
    connection.userId = userId;
    connection.username = username;
    connection.uuid = uuid;

    unique = !isUserConnected(username);
  }

  connections[socket.id] = connection;

  return unique;
};

exports.removeConnection = function(socket) {
  var unique = true;

  var connection = connections[socket.id];
  delete connections[socket.id];

  var username = connection.username;
  if (username) {
    unique = !isUserConnected(username);
  }

  return unique;
};

exports.init = function(_config, callback) {
  config = _config;

  app = express();
  app.use(bodyParser.json());

  app.get('/users', function(req, res) {
    var userMap = {};
    var result = [];

    var id;
    for (id in connections) {
      if (!connections.hasOwnProperty(id)) {
        continue;
      }

      var connection = connections[id];
      if (connection.type == 'chat' && connection.username &&
          !userMap[connection.username]) {
        userMap[connection.username] = true;

        result.push({
          username: connection.username,
          uuid: connection.uuid
        });
      }
    }

    res.send({
      users: result
    });
  });
  
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
  
  var options = {
    uri: 'http://' + config.website + '/api/v1/servers'
  };
  
  request(options, function(error, response, body) {
    if (error || response.statusCode != 200) {
      return callback(new Error("Not able to get list of servers from api!"));
    }
    
    var data = JSON.parse(body);
    
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
      
    return callback();
  });
};

exports.start = function() {
  var server = app.listen(config.port);
  io = socketio.listen(server);
  
  streams.startStreams();
  
  consoleServer.start(io, apis);
  chatServer.start(io, apis);

  setupUserEndpoint('messages');
};

exports.apis = apis;
exports.connections = connections;
exports.serverStatus = serverStatus;
