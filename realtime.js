var http = require('http')
  , socketio = require('socket.io')
  , ansitohtml = require('ansi-to-html')
  , request = require('request')
  , rollbar = require('rollbar')
  , jsonapi = require('./jsonapi')
  , streams = require('./streams');

var RealtimeServer = function() {
  this.app = null;
  this.io = null;
  this.config = null;
  this.apis = [];
  
  // Use to counter spammy users
  this.nextConnectionTimes = {};
  this.nextChatTimes = {};
  
  this.ansiconvert = null;
  
  this.connectedUsers = [];
}

RealtimeServer.prototype = {
  init : function(config) {
    this.config = config;
    
    var self = this;
    
    this.app = http.createServer(function(req, res) {
      res.writeHead(200);
      res.write(JSON.stringify(self.connectedUsers));
      res.end();
    });
    
    rollbar.init(config.rollbar.accessToken, {
      environment: config.rollbar.environment,
      root: config.rollbar.root,
      branch: config.rollbar.branch
    });
    
    if (!config.debug) {
      rollbar.handleUncaughtExceptions();
    }
    
    this.ansiconvert = new ansitohtml();
    
    for (var id in config.servers) {
      var address = config.servers[id];
      
      var api = new jsonapi.JSONAPI({
        hostname: address,
        port: config.mcApiPort,
        username: config.mcApiUsername,
        password: config.mcApiPassword,
        salt: config.mcApiSalt
      });
      
      this.apis[id] = api;
    }
      
    exports.apis = this.apis;
  },
  
  /* Authenticates the socket connection request by checking the Django session
   * key with the website api.
   *
   * If the user is logged in and their session key is valid, their user_id and
   * username will be stored in the socket and the connection will proceed.
   * 
   * If the admin parameter is set, the api will make sure the user associated
   * with the session key is an admin, otherwise the api will return a 403. */
  authSocket : function(socket, isAdmin, callback) {
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
        uri: 'http://' + self.config.website + '/api/auth_session_key',
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
  },
  
  getPlayers : function(api, socket) {
    api.call('server_status', function(error, data) {
      if (!error) {
        socket.emit('player-list', {
          players: data.success.players,
          numPlayers: data.success.numplayers,
          maxPlayers: data.success.maxplayers
        });
      }
    });
  },
  
  addConnectedUser : function(socket, type) {
    var user = {
      socketId: socket.id,
      connectionTime: Math.floor(new Date().getTime() / 1000),
      address: socket.handshake.address.address,
      type: type
    };
    
    if (socket.userId && socket.username) {
      user.id = socket.userId;
      user.username = socket.username;
      
      for (var i = 0; i < this.connectedUsers.length; ++i) {
        var existingUser = this.connectedUsers[i];
        
        if (existingUser.id == user.id && existingUser.type == type) {
          return false;
        }
      }
    }
    
    this.connectedUsers.push(user);
    
    return true;
  },
  
  removeConnectedUser : function(socketId) {
    var i = this.connectedUsers.length;
    while (i--) {
      var existingUser = this.connectedUsers[i];
      
      if (existingUser.socketId == socketId) {
        this.connectedUsers.splice(i, 1);
        return;
      }
    }
  },
  
  start : start = function() {
    this.app.listen(this.config.port);
    this.io = socketio.listen(this.app);
  
    this.io.set('log level', 1);
    
    streams.startStreams();
    
    var self = this;
    
    this.io
    .of('/console')
    .on('connection', function(socket) {
      self.authSocket(socket, true, function(error) {
        // Some sort of error, the socket is disconnected at this point so end
        if (error) {
          return;
        }
        
        var api = self.apis[socket.serverId];
        
        self.addConnectedUser(socket, 'console');
        
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
          line = self.ansiconvert.toHtml(line);
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
        
        self.getPlayers(api, socket);
        
        streams.addListener(socket.id, socket.serverId, 'connections', function(error, data) {
          if (!error) {
            self.getPlayers(api, socket);
          }
        });
        
        socket.on('disconnect', function() {
          streams.removeListeners(socket.id);
          self.removeConnectedUser(socket.id);
        });
      });
    });
    
    this.io
    .of('/chat')
    .on('connection', function (socket) {
      self.authSocket(socket, false, function(error) {
        // Some sort of error, the socket is disconnected at this point so end
        if (error) {
          return;
        }
        
        var api = self.apis[socket.serverId];
        
        if (socket.username) {
          var now = new Date().getTime();
          if (self.nextConnectionTimes[socket.username] && now < self.nextConnectionTimes[socket.username]) {
            self.nextConnectionTimes[socket.username] = now + 30000;
            socket.emit('connection-spam');
            return;
          }
          
          self.nextConnectionTimes[socket.username] = now + 1000;
        }
        
        var uniqueConnection = self.addConnectedUser(socket, 'chat');
        
        if (socket.username && uniqueConnection) {
          api.call('web_chat', ['enter', socket.username]);
        }
        
        socket.on('chat-input', function (data) {
          if (socket.username) {
            if (data.message) {
              var now = new Date().getTime();
              var nextChatDelay = 500;
              
              if (self.nextChatTimes[socket.username] && now < self.nextChatTimes[socket.username]) {
                socket.emit('chat-spam');
                nextChatDelay += 2000;
              } else {
                api.call('web_chat', ['message', socket.username, data.message], function(data) {});
              }
              
              self.nextChatTimes[socket.username] = now + nextChatDelay;
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
          var forumpat = /\[Forum\]/;
          
          var line = data.success.line.trim().substring(26);
          
          if (line.match(chatpat) ||
              line.match(webchatpat) ||
              line.match(serverpat) ||
              line.match(forumpat)) {
            line = self.ansiconvert.toHtml(line);
            socket.emit('chat', {
              line: line
            });
          }
        });
        
        self.getPlayers(api, socket);
        
        streams.addListener(socket.id, socket.serverId, 'connections', function(error, data) {
          if (!error) {
            self.getPlayers(api, socket);
            
            if (self.config.hiddenUsers && self.config.hiddenUsers.indexOf(data.success.player) != -1) {
              return;
            }
            
            var line = '<span style="color:#A50">' + data.success.player + " " + data.success.action + '</span>';
            
            socket.emit('chat', {
              line: line
            });
          }
        });
        
        socket.on('disconnect', function() {
          streams.removeListeners(socket.id);
          self.removeConnectedUser(socket.id);
          
          if (socket.username && uniqueConnection) {
            api.call('web_chat', ['exit', socket.username]);
          }
        });
      });
    });
  }
}

exports.RealtimeServer = RealtimeServer;