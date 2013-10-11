var http = require('http')
  , socketio = require('socket.io')
  , request = require('request')
  , rollbar = require('rollbar')
  , events = require('events')
  , jsonapi = require('./jsonapi')
  , streams = require('./streams')
  , consoleServer = require('./sockets/console')
  , chatServer = require('./sockets/chat');

var app = null;
var io = null;
var config = null;
var apis = {};

var connections = {};

var authorizeDjangoSessionKey = function(djangoSessionKey, elevated, callback) {
  var form = {
    'session-key': djangoSessionKey
  };

  if (elevated) {
    form['elevated'] = true;
  }

  var options = {
    uri: 'http://' + config.website + '/api/v1/auth_session_key',
    method: 'POST',
    form: form
  };

  request(options, function(error, response, body) {
    if (error) {
      return callback("Auth request error: " + error);
    }

    if (response.statusCode != 200) {
      return callback('Bad auth status code: ' + response.statusCode);
    }

    var result = JSON.parse(body);

    // Successful authentication and authorization
    return callback(null, {
      userId: result.user_id,
      username: result.username
    });
  });
};

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

/* Called during socket.io authorization, this function will first try to grab
 * the Django session key stored in the request's cookies if it exists. If it
 * does, a call will be made to the website API to authorize this key, the result
 * of which will be used to determine if authorization should be accepted or denied.
 *
 * If there is no session key, the allowAnonymous param will determine if authorization
 * should be accepted or denied. */
exports.authorize = function(handshakeData, elevated, allowAnonymous, callback) {
  var cookie = handshakeData.headers.cookie || '';

  var match = cookie.match(/sessionid=([a-z0-9]+)/);

  if (match) {
    var sessionId = match[1];

    authorizeDjangoSessionKey(sessionId, elevated, function(error, userData) {
      if (error) {
        console.log(error);
        callback(null, false);
      } else {
        handshakeData.userId = userData.userId;
        handshakeData.username = userData.username;
        callback(null, true);
      }

    });
  } else {
    // Anonymous request
    callback(null, allowAnonymous);
  }
};

exports.addConnection = function(socket, type) {
  var address = 'unknown';
  if (socket.handshake) {
    address = socket.handshake.headers['x-real-ip'] || socket.handshake.address.address;
  }

  var unique = true;

  var userId = socket.handshake.userId;
  var username = socket.handshake.username;

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
    
    var result = JSON.parse(body);
    
    var i;
    for (i = 0; i < result.length; ++i) {
      var server = result[i];
      var id = server.id;
      var address = server.address;
      
      apis[id] = new jsonapi.JSONAPI({
        hostname: address,
        port: config.mcApiPort,
        username: config.mcApiUsername,
        password: config.mcApiPassword,
        salt: config.mcApiSalt
      });
    }
      
    return callback();
  });
};

exports.start = function() {
  app.listen(config.port);
  io = socketio.listen(app, {
    'browser client minification': true
  });

  io.set('log level', 1);
  
  streams.startStreams();
  
  consoleServer.start(io, apis);
  chatServer.start(io, apis);
};

exports.apis = apis;
exports.connections = connections;