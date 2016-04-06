var common = require('./common')
  , internalApi = require('../internalapi')
  , streams = require('../streams')
  , realtime = require('../realtime')
  , util = require('../util')
  , constants = require('../constants');

var chatRegexStripPat = /\[\*WC\*\]/;
var consoleChatRegexStripPat = /\[\*CWC\*\]/;

var chatRegexPats = [
  /(?!AllianceChat|FactionChat|issued\ server\ command)<.+>\ /,
  /\[Server/,
  chatRegexStripPat,
  consoleChatRegexStripPat
];

var urlpat = /(\w*\.?\w+\.[\w+]{2,3}[\.\/\?\w&=\-]*)/;

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
  var userId = socket.userId;
  var uuid = socket.uuid;
  var username = socket.username;

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
        uuid: uuid,
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
  var uuid = socket.uuid;
  var username = socket.username;

  if (uuid && broadcast && !socket.blocked) {
    api.call('web_chat', {
      type: 'exit',
      uuid: uuid,
      username: username
    });
  }
};

// Use to counter spammy users
var nextConnectionTimes = {};
var nextChatTimes = {};

exports.start = function(io, apis) {
  io
  .of('/chat')
  .on('connection', function(socket) {
    socket.on('auth', function(data) {
      socket.removeAllListeners('auth');
      realtime.authorize(socket, data, false, true, function(err, userId, username, uuid, isSuperuser, isModerator) {
        if (err) {
          socket.emit('unauthorized');
          return;
        }

        var serverId = data.serverId;
        var api = apis[serverId];

        if (!api) {
          socket.emit('unauthorized');
          return;
        }

        socket.userId = userId;
        socket.username = username;
        socket.uuid = uuid;
        socket.isSuperuser = isSuperuser;
        socket.isModerator = isModerator;

        var unique = realtime.addConnection(socket, 'chat');
        joinServer(socket, api, unique);

        streams.addListener(socket.id, serverId, 'console', function(error, data) {
          common.handleStreamData(error, data, socket, 'chat', function(line) {
            if (!patMatch(line)) {
              return null;
            }

            line = line.replace(chatRegexStripPat, '');
            line = line.replace(consoleChatRegexStripPat, '');

            // Remove time and log level
            line = line.trim().substring(16);

            // Encode '<' and '>'
            line = util.htmlEncode(line);

            line = util.ansiConvert.toHtml(line);

            // Linkify possible urls
            line = line.replace(urlpat, '<a href="http://$1" target="_blank">$1</a>');

            return line;
          });
        });

        var statusInterval = setInterval(function() {
          common.sendServerStatus(socket, serverId);
        }, 1000);

        socket.on('chat-input', function (data) {
          if (socket.blocked) {
            return;
          }

          var connection = realtime.connections[socket.id];
          connection.lastActive = Math.round(Date.now() / 1000);

          var userId = socket.userId;
          var uuid = socket.uuid;
          var username = socket.username;
          if (userId) {
            if (data.message) {
              data.message = data.message.substring(0, Math.min(80, data.message.length));

              var now = new Date().getTime();
              var nextChatDelay = 600;

              if (nextChatTimes[userId] && now < nextChatTimes[userId]) {
                socket.emit('chat-spam');
                nextChatDelay += (0.5 * nextChatDelay) + 2000;
              } else {
                api.call('web_chat', {
                  type: 'message',
                  uuid: uuid,
                  username: username,
                  message: data.message
                }, function(error, data) {
                  if (!error) {
                    if (data.result == constants.API_CALL_RESULTS['banned']) {
                      socket.emit('chat', {
                        line: "Whoops, looks like you are banned on the server! You won't be able to send any messages."
                      });
                    } else if (data.result == constants.API_CALL_RESULTS['muted']) {
                      socket.emit('chat', {
                        line: "You have been muted!"
                      });
                    } else if (data.result == constants.API_CALL_RESULTS['never_joined']) {
                      socket.emit('chat', {
                        line: "You haven't joined this server yet, you need to join once to be able to use web chat."
                      });
                    }
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
          connection.lastActive = Math.round(Date.now() / 1000);
        });

        socket.on('disconnect', function() {
          var unique = realtime.removeConnection(socket);

          streams.removeListeners(socket.id);
          clearInterval(statusInterval);

          leaveServer(socket, api, unique);
        });
      });
    });
  });
};