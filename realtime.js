var http = require('http')
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

var initServerStatusGetter = function(serverId) {
  var api = apis[serverId];

  var getter = function() {
    api.call('server_status', function(error, data) {
      if (error) {
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

exports.authorize = function(data, elevated, allowAnonymous, callback) {
  if (data.auth_data && data.auth_data.token) {
    var userId = data.auth_data.user_id;
    var username = data.auth_data.username;
    var isSuperuser = data.auth_data.is_superuser;
    var token = data.auth_data.token;

    var content = [userId, username, isSuperuser].join('-');

    var shasum = crypto.createHash('sha256');
    var checkToken = shasum.update(content + config.authSecret).digest('hex');

    if (token === checkToken && (!elevated || isSuperuser)) {
      return callback(null, userId, username);
    } else {
      return callback('Unauthorized');
    }
  } else if (allowAnonymous) {
    return callback(null);
  } else {
    return callback('Unauthorized');
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
  
  app = http.createServer(function(req, res) {
    if (req.url.indexOf("/users", req.url.length - 6) !== -1) {
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
            username: connection.username
          });
        }
      }
      
      res.writeHead(200, {
        'Content-Type': 'application/json'
      });
      
      res.write(JSON.stringify({
        users: result
      }));
    } else {
      res.writeHead(200);
    }
    
    res.end();
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
  app.listen(config.port);
  io = socketio.listen(app);

  io.set('log level', 1);
  
  streams.startStreams();
  
  consoleServer.start(io, apis);
  chatServer.start(io, apis);
};

exports.apis = apis;
exports.connections = connections;
exports.serverStatus = serverStatus;