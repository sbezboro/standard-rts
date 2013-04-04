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

var rollbar = require("rollbar");
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

function authSocket(socket, admin, callback) {
  socket.on('auth', function(data) {
    if (!data.djangoSessionKey || !data.serverId) {
      socket.emit('unauthorized');
      socket.disconnect();
    }
    
    var options = {
      uri: 'http://' + config.website + '/api/auth_session_key',
      method: 'POST',
      form: {
        'session-key': data.djangoSessionKey,
        'is-admin': admin
      }
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
      
      return callback(null, serverId, username);
    });
  });
}

io
.of('/console')
.on('connection', function (socket) {
  authSocket(socket, true, function(error, serverId, username) {
    // Some sort of error, the socket is disconnected at this point so end
    if (error) {
      return;
    }
    
    // Store the current connected user's username for future use
    socket.set('username', username);
    socket.set('serverId', serverId);
    
    var api = apis[serverId];
    
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
    api.stream('connections', function(json) {
      if (json.success.time > now) {
        getPlayers();
      }
    });
  });
});
