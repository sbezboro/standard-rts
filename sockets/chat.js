var server = require('./server')
  , streams = require('../streams')
  , realtime = require('../realtime')
  , util = require('../util');

var chatRegexStripPat = /\[\*WC\*\]/;
var consoleChatRegexStripPat = /\[\*CWC\*\]/;

var chatRegexPats = [
  /<.*>\ /,
  /\[Server\]/,
  chatRegexStripPat,
  consoleChatRegexStripPat
];

var boldPat = /\<\/?b\>/g;

var patMatch = function(line) {
  for (var i = 0; i < chatRegexPats.length; ++i) {
    if (line.match(chatRegexPats[i])) {
      return true;
    }
  }
  
  return false;
};
  
// Use to counter spammy users
var nextConnectionTimes = {};
var nextChatTimes = {};

exports.start = function(io, apis) {
  io
  .of('/chat')
  .on('connection', function(socket) {
    realtime.authSocket(socket, false, function(error) {
      // Some sort of error, the socket is disconnected at this point so end
      if (error) {
        return;
      }
      
      var api = apis[socket.serverId];
        
      var uniqueConnection = realtime.addConnectedUser(socket, 'chat');
      
      var lastError;
      streams.addListener(socket.id, socket.serverId, 'console', function(error, data) {
        server.handleStreamData(error, data, socket, 'chat', lastError, function(line) {
          if (!patMatch(line)) {
            return null;
          }
          
          line = line.replace(chatRegexStripPat, '');
          line = line.replace(consoleChatRegexStripPat, '');
          
          line = line.trim().substring(26);
          
          // Encode '<' and '>'
          line = util.htmlEncode(line);
          
          line = util.ansiConvert.toHtml(line);
          
          // Strip out bold tags
          line = line.replace(boldPat, '');
          
          return line;
        });
      });
      
      streams.addListener(socket.id, socket.serverId, 'connections', function(error, data) {
        if (!error) {
          server.getStatus(api, socket);
        }
      });
      
      server.getStatus(api, socket);
      
      // Set up streams and announce to the server that this user has
      // joined web chat (if logged in)
      function joinServer() {
        if (socket.username) {
          var now = new Date().getTime();
          if (nextConnectionTimes[socket.username] && now < nextConnectionTimes[socket.username]) {
            nextConnectionTimes[socket.username] = now + 30000;
            socket.emit('connection-spam');
            socket.blocked = true;
            return false;
          }
          
          nextConnectionTimes[socket.username] = now + 1000;
        }
        
        if (uniqueConnection && socket.username && !socket.blocked) {
          api.call('web_chat', {
            type: 'enter',
            username: socket.username
          });
        }
        
        socket.blocked = false;
        return true;
      }
      
      // Remove streams and announce to the server that this user has
      // left web chat (if logged in)
      function leaveServer() {
        streams.removeListeners(socket.id);
        
        if (uniqueConnection && socket.username && !socket.blocked) {
          api.call('web_chat', {
            type: 'exit',
            username: socket.username
          });
        }
      }
      
      joinServer();
      
      socket.on('chat-input', function (data) {
        if (socket.blocked) {
          return;
        }
        
        if (socket.username) {
          if (data.message) {
            data.message = data.message.substring(0, Math.min(80, data.message.length));
            
            var now = new Date().getTime();
            var nextChatDelay = 500;
            
            if (nextChatTimes[socket.username] && now < nextChatTimes[socket.username]) {
              socket.emit('chat-spam');
              nextChatDelay += 2000;
            } else {
              api.call('web_chat', {
                type: 'message',
                username: socket.username,
                message: data.message
              }, function(data) {});
            }
            
            nextChatTimes[socket.username] = now + nextChatDelay;
          }
        } else {
          socket.emit('chat', {
            line: "You must log in first before you can chat!"
          });
        }
      });
      
      socket.on('user-activity', function (data) {
        if (socket.blocked) {
          return;
        }
        
        if (socket.user) {
          socket.user.active = data.active;
        }
      });
      
      socket.on('disconnect', function() {
        leaveServer();
        if (uniqueConnection) {
          realtime.removeConnectedUser(socket);
        }
      });
    });
  });
}