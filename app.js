var http = require('http')
  , app = http.createServer(handler)
  , io = require('socket.io').listen(app)
  , convert = require('ansi-to-html')
  , request = require('request')
  , rollbar = require("rollbar")
  , jsonapi = require('./jsonapi')
  , config = require('./config')
  , streams = require('./streams');

function handler(req, res) {
  res.writeHead(200);
  res.end();
}

io.set('log level', 1);

rollbar.init(config.rollbar.accessToken, {
  environment: config.rollbar.environment,
  root: config.rollbar.root,
  branch: config.rollbar.branch
});
rollbar.handleUncaughtExceptions();

app.listen(config.port);

var c = new convert();
var apis = {};

for (var id in config.servers) {
  var address = config.servers[id];
  
  var api = new jsonapi.JSONAPI({
    hostname: address,
    port: config.mcApiPort,
    username: config.mcApiUsername,
    password: config.mcApiPassword,
    salt: config.mcApiSalt
  });
  
  apis[id] = api;
}

exports.apis = apis;

streams.startStreams();

/* Authenticates the socket connection request by checking the Django session
 * key with the website api.
 *
 * If the user is logged in and their session key is valid, their username
 * will be stored in the socket.
 * 
 * If the admin parameter is set, the api will make sure the user associated
 * with the session key is an admin, otherwise the api will return a 403. */
function authSocket(socket, admin, callback) {
  socket.on('auth', function(data) {
    if (!data.djangoSessionKey || !data.serverId) {
      socket.emit('unauthorized');
      socket.disconnect();
    }
    
    var form = {
      'session-key': data.djangoSessionKey,
    }
    
    if (admin) {
      form['is-admin'] = true;
    }
    
    var options = {
      uri: 'http://' + config.website + '/api/auth_session_key',
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
      
      var serverId = data.serverId;
      var username = JSON.parse(body).username;
    
      // Store the current connected user's username for future use
      socket.username = username;
      socket.serverId = serverId;
      
      return callback(null);
    });
  });
}

io
.of('/console')
.on('connection', function (socket) {
  authSocket(socket, true, function(error) {
    // Some sort of error, the socket is disconnected at this point so end
    if (error) {
      return;
    }
    
    var api = apis[socket.serverId];
    
    var lastError;
    streams.addListener(socket.id, socket.serverId, 'console', function(error, data) {
      if (error) {
        if (!lastError) {
          lastError = error;
          socket.emit('mc-connection-lost');
        }
        return;
      } else {
        lastError = null;
      }
      
      var urlpat = /(\w*\.?\w+\.[\w+]{2,3}[\/\?\w&=-]*)/;
      var line = data.success.line.trim().substring(11);
      
      // Convert ansi color to html
      line = c.toHtml(line);
      // Linkify possible urls
      line = line.replace(urlpat, '<a href="http://$1" target="_blank">$1</a>');
      
      socket.emit('console', {
        line: line
      });
    });
    
    socket.on('console-input', function(data) {
      if (data.message) {
        api.call('runConsoleCommand', "say " + data.message);
      } else if (data.command) {
        api.call('runConsoleCommand', data.command);
      }
    });
    
    var getPlayers = function() {
      api.call('server_status', function(error, data) {
        if (!error) {
          socket.emit('player-list', {
            players: data.success.players,
            numPlayers: data.success.numplayers,
            maxPlayers: data.success.maxplayers
          });
        }
      });
    }
    
    getPlayers();
    
    streams.addListener(socket.id, socket.serverId, 'connections', function(error, data) {
      if (!error) {
        getPlayers();
      }
    });
    
    socket.on('disconnect', function() {
      streams.removeListeners(socket.id);
    });
  });
});

io
.of('/chat')
.on('connection', function (socket) {
  authSocket(socket, false, function(error) {
    // Some sort of error, the socket is disconnected at this point so end
    if (error) {
      return;
    }
    
    var api = apis[socket.serverId];
    
    // Listen for chat input if the user is authenticated
    socket.on('chat-input', function (data) {
      if (socket.username) {
        if (data.message) {
          api.call('web_chat', [socket.username, data.message], function(data) {
          });
        }
      } else {
        socket.emit('chat', {
          line: "You must log in first before you can chat!"
        });
      }
    });
    
    var lastError;
    streams.addListener(socket.id, socket.serverId, 'console', function(error, data) {
      if (error) {
        if (!lastError) {
          lastError = error;
          socket.emit('mc-connection-lost');
        }
        return;
      } else {
        lastError = null;
      }
      
      var chatpat = /<.*>\ /;
      var webchatpat = /\[Web Chat\]/;
      var serverpat = /\[Server\]/;
      
      var line = data.success.line.trim().substring(26);
      
      if (line.match(chatpat) ||
          line.match(webchatpat) ||
          line.match(serverpat)) {
        line = c.toHtml(line);
        socket.emit('chat', {
          line: line
        });
      }
    });
    
    streams.addListener(socket.id, socket.serverId, 'connections', function(error, data) {
      if (!error) {
        var line = data.success.player + " " + data.success.action;
        
        socket.emit('chat', {
          line: line
        });
      }
    });
    
    socket.on('disconnect', function() {
      streams.removeListeners(socket.id);
    });
  });
});