var http = require('http')
  , app = http.createServer(handler)
  , io = require('socket.io').listen(app)
  , convert = require('ansi-to-html')
  , request = require('request')
  , rollbar = require("rollbar")
  , jsonapi = require('./jsonapi')
  , config = require('./config');

function handler(req, res) {
  res.writeHead(200);
  res.end();
}

rollbar.init(config.rollbar.accessToken, {
  environment: config.rollbar.environment,
  root: config.rollbar.root,
  branch: config.rollbar.branch
});
rollbar.handleUncaughtExceptions();

app.listen(config.port);

var apis = {};
var c = new convert();

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

// Authenticates the socket connection request by checking the Django session
// key through the website api.
// On success, stores the user's username and requeted server id in the socket
// and continues the connection.
// On authentication failure or admin authorization failure, the socket is
// disconnected with a relevant message
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
    
    api.stream('console', function(data) {
      var pat = /(\w*\.?\w+\.[\w+]{2,3}[\/\?\w&=-]*)/;
      var line = data.success.line.trim().substring(11);
      
      // Convert ansi color to html
      line = c.toHtml(line);
      // Linkify possible urls
      line = line.replace(pat, '<a href="http://$1" target="_blank">$1</a>');
      
      socket.emit('console', {
        line: line
      });
    });
    
    socket.on('console-input', function (data) {
      if (data.message) {
        api.call('runConsoleCommand', "say " + data.message);
      } else if (data.command) {
        api.call('runConsoleCommand', data.command);
      }
    });
    
    var getPlayers = function() {
      api.call('getPlayerNames', function(data) {
        var players = [];
        for (var i = 0; i < data.success.length; ++i) {
          players.push({
            username: data.success[i]
          });
        }
        
        socket.emit('player-list', {
          players: players,
          numPlayers: players.length,
          maxPlayers: 60
        });
      });
    }
    
    getPlayers();
    
    var now = new Date().getTime() / 1000;
    api.stream('connections', function(data) {
      if (data.success.time > now) {
        getPlayers();
      }
    });
  });
});

io
.of('/chat')
.on('connection', function (socket) {
  authSocket(socket, false, function(error) {
    var now = new Date().getTime() / 1000;
    
    // Some sort of error, the socket is disconnected at this point so end
    if (error) {
      return;
    }
    
    var api = apis[socket.serverId];
    
    socket.on('chat-input', function (data) {
      if (data.message) {
        api.call('web_chat', [socket.username, data.message], function(data) {
        });
      }
    });
    
    api.stream('console', function(data) {
      if (data.success.time > now - 300) {
        var chatpat = /<.*>.*/;
        var webchatpat = /\[Web Chat\]/;
        var serverpat = /\[Server\]/;
        var jsonapipat = /\[JSONAPI\]/;
        
        var line = data.success.line.trim().substring(26);
        
        if (!line.match(jsonapipat) && (line.match(chatpat) ||
             line.match(webchatpat) ||
             line.match(serverpat))) {
          line = c.toHtml(line);
          socket.emit('chat', {
            line: line
          });
        }
      }
    });
    
    api.stream('connections', function(data) {
      if (data.success.time > now) {
        var line = data.success.player + " " + data.success.action;
        
        socket.emit('chat', {
          line: line
        });
      }
    });
  });
});