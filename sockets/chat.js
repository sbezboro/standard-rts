var common = require('./common')
  , streams = require('../streams')
  , realtime = require('../realtime')
  , util = require('../util')
  , constants = require('../constants');

var chatRegexStripPat = /\[\*WC\*\]/;
var consoleChatRegexStripPat = /\[\*CWC\*\]/;

var chatRegexPats = [
  /<.*>\ /,
  /\[Server/,
  chatRegexStripPat,
  consoleChatRegexStripPat
];

var urlpat = /(\w*\.?\w+\.[\w+]{2,3}[\.\/\?\w&=\-]*)/;
var boldPat = /\<\/?b\>/g;

var patMatch = function(line) {
  for (var i = 0; i < chatRegexPats.length; ++i) {
    if (line.match(chatRegexPats[i])) {
      return true;
    }
  }
  
  return false;
};

// Set up streams and announce to the server that this user has
// joined web chat (if logged in)
var joinServer = function(socket, api, broadcast) {
  var userId = socket.handshake.userId;
  var username = socket.handshake.username;

  if (userId) {
    var now = new Date().getTime();
    if (nextConnectionTimes[userId] && now < nextConnectionTimes[userId]) {
      nextConnectionTimes[userId] = now + 30000;
      socket.emit('connection-spam');
      socket.blocked = true;
      return false;
    }

    nextConnectionTimes[userId] = now + 1000;

    if (broadcast && !socket.blocked) {
      api.call('web_chat', {
        type: 'enter',
        username: username
      });
    }
  }

  socket.blocked = false;
  return true;
};

// Remove streams and announce to the server that this user has
// left web chat (if logged in)
var leaveServer = function(socket, api, broadcast) {
  var username = socket.handshake.username;
  if (username && broadcast && !socket.blocked) {
    api.call('web_chat', {
      type: 'exit',
      username: username
    });
  }
}

// Use to counter spammy users
var nextConnectionTimes = {};
var nextChatTimes = {};

exports.start = function(io, apis) {
  io
  .of('/chat')
  .authorization(function(data, callback) {
    realtime.authorize(data, false, true, callback);
  })
  .on('connection', function(socket) {
    socket.on('server', function(data) {
      socket.removeAllListeners('server');

      var serverId = data.serverId;
      var api = apis[serverId];

      var unique = realtime.addConnection(socket, 'chat');
      joinServer(socket, api, unique);
      
      var lastError;
      streams.addListener(socket.id, serverId, 'console', function(error, data) {
        common.handleStreamData(error, data, socket, 'chat', lastError, function(line) {
          if (!patMatch(line)) {
            return null;
          }
          
          line = line.replace(chatRegexStripPat, '');
          line = line.replace(consoleChatRegexStripPat, '');

          // Remove time and log level
          line = line.trim().substring(26);
          
          // Encode '<' and '>'
          line = util.htmlEncode(line);
          
          line = util.ansiConvert.toHtml(line);
          
          // Strip out bold tags
          line = line.replace(boldPat, '');
          
          // Linkify possible urls
          line = line.replace(urlpat, '<a href="http://$1" target="_blank">$1</a>');
          
          return line;
        });
      });
      
      streams.addListener(socket.id, serverId, 'connections', function(error, data) {
        if (!error) {
          common.getStatus(api, socket);
        }
      });
      
      common.getStatus(api, socket);
      
      socket.on('chat-input', function (data) {
        if (socket.blocked) {
          return;
        }

        var userId = socket.handshake.userId;
        var username = socket.handshake.username;
        if (userId) {
          if (data.message) {
            data.message = data.message.substring(0, Math.min(80, data.message.length));
            
            var now = new Date().getTime();
            var nextChatDelay = 500;
            
            if (nextChatTimes[userId] && now < nextChatTimes[userId]) {
              socket.emit('chat-spam');
              nextChatDelay += 2000;
            } else {
              api.call('web_chat', {
                type: 'message',
                username: username,
                message: data.message
              }, function(error, data) {
                data = data.success;
                if (data && data.result == constants.API_CALL_RESULTS['BANNED']) {
                  socket.emit('chat', {
                    line: "Whoops, looks like you are banned on the server! You won't be able to send any messages."
                  });
                }
              });
            }
            
            nextChatTimes[userId] = now + nextChatDelay;
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

        var connection = realtime.connections[socket.id];
        connection.active = data.active;
      });
      
      socket.on('disconnect', function() {
        var unique = realtime.removeConnection(socket);

        streams.removeListeners(socket.id);

        leaveServer(socket, api, unique);
      });
    });
  });
}