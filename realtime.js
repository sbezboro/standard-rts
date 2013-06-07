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
var apis = [];
  
var connectedUsers = [];

/* Authenticates the socket connection request by checking the Django session
 * key with the website api.
 *
 * If the user is logged in and their session key is valid, their user_id and
 * username will be stored in the socket and the connection will proceed.
 * 
 * If the admin parameter is set, the api will make sure the user associated
 * with the session key is an admin, otherwise the api will return a 403. */
exports.authSocket = function(socket, isAdmin, callback) {
  var self = this;
  
  socket.on('auth', function(data) {
    // The client must provide a serverId. It must also provide djangoSessionKey
    // if this request is for an elevated privilege socket
    if (!data.serverId || (!data.djangoSessionKey && isAdmin)) {
      socket.emit('unauthorized');
      socket.disconnect();
      return callback(new Error());
    }
    
    socket.serverId = data.serverId;
    
    // Anonymous request, just continue the socket connection without storing user data
    if (!data.djangoSessionKey) {
      return callback(null);
    }
    
    var form = {
      'session-key': data.djangoSessionKey,
    }
    
    if (isAdmin) {
      form['is-admin'] = true;
    }
    
    var options = {
      uri: 'http://' + config.website + '/api/v1/auth_session_key',
      method: 'POST',
      form: form
    }
    
    request(options, function(error, response, body) {
      if (error) {
        socket.disconnect();
        return callback(new Error());
      }
      
      if (response.statusCode != 200) {
        socket.emit('unauthorized');
        socket.disconnect();
        return callback(new Error());
      }
      
      var result = JSON.parse(body);
    
      // Store the authenticated user's id and username for future use
      socket.userId = result.user_id;
      socket.username = result.username;
      
      return callback(null);
    });
    
    return null;
  });
};

exports.addConnectedUser = function(socket, type) {
  var user = {
    socketId: socket.id,
    connectionTime: Math.floor(new Date().getTime() / 1000),
    address: socket.handshake.address.address,
    type: type
  };
  
  if (socket.userId && socket.username) {
    user.id = socket.userId;
    user.username = socket.username;
    
    for (var i = 0; i < connectedUsers.length; ++i) {
      var existingUser = connectedUsers[i];
      
      if (existingUser.id == user.id && existingUser.type == type) {
        return false;
      }
    }
  }
  
  connectedUsers.push(user);
  
  return true;
}

exports.removeConnectedUser = function(socketId) {
  var i = connectedUsers.length;
  while (i--) {
    var existingUser = connectedUsers[i];
    
    if (existingUser.socketId == socketId) {
      connectedUsers.splice(i, 1);
      return;
    }
  }
}

exports.init = function(_config, callback) {
  config = _config;
  
  app = http.createServer(function(req, res) {
    res.writeHead(200);
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
  }
  
  request(options, function(error, response, body) {
    if (error || response.statusCode != 200) {
      return callback(new Error("Not able to get list of servers from api!"));
    }
    
    var result = JSON.parse(body);
    
    result.map(function(server) {
      var id = server.id;
      var address = server.address;
      
      var api = new jsonapi.JSONAPI({
        hostname: address,
        port: config.mcApiPort,
        username: config.mcApiUsername,
        password: config.mcApiPassword,
        salt: config.mcApiSalt
      });
      
      apis[id] = api;
    });
      
    return callback();
  });
}

exports.start = function() {
  app.listen(config.port);
  io = socketio.listen(app);

  io.set('log level', 1);
  
  streams.startStreams();
  
  consoleServer.start(io, apis);
  chatServer.start(io, apis);
}

exports.apis = apis;
exports.connectedUsers = connectedUsers;