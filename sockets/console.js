var common = require('./common')
  , streams = require('../streams')
  , realtime = require('../realtime')
  , util = require('../util');

var chatRegexPat = /\[\*WC\*\]/;
var consoleChatRegexStripPat = /\[\*CWC\*\]/;

var urlpat = /(\w*\.?\w+\.[\w+]{2,3}[\.\/\?\w&=\-]*)/;
var boldPat = /\<\/?b\>/g;

exports.start = function(io, apis) {
  io
  .of('/console')
  .on('connection', function(socket) {
    realtime.authSocket(socket, true, function(error) {
      // Some sort of error, the socket is disconnected at this point so end
      if (error) {
        return;
      }
      
      var api = apis[socket.serverId];
      
      realtime.addConnectedUser(socket, 'console');
      
      var lastError;
      streams.addListener(socket.id, socket.serverId, 'console', function(error, data) {
        common.handleStreamData(error, data, socket, 'console', lastError, function(line) {
          if (line.match(chatRegexPat)) {
            return null;
          }
          
          line = line.replace(consoleChatRegexStripPat, '');
          
          line = line.trim().substring(11);
          
          // Encode '<' and '>'
          line = util.htmlEncode(line);
          
          // Convert ansi color to html
          line = util.ansiConvert.toHtml(line);
          
          // Strip out bold tags
          line = line.replace(boldPat, '');
          
          // Linkify possible urls
          line = line.replace(urlpat, '<a href="http://$1" target="_blank">$1</a>');
          
          return line;
        });
      });
      
      common.getStatus(api, socket, true);
      
      var statusInterval = setInterval(function() {
        common.getStatus(api, socket, true);
        socket.emit('chat-users', {
          users: realtime.connectedUsers
        });
      }, 2000);
      
      socket.on('console-input', function(data) {
        if (data.message) {
          api.call('runConsoleCommand', "say " + data.message);
        } else if (data.command) {
          api.call('runConsoleCommand', data.command);
        }
      });
      
      socket.on('set-donator', function(data) {
        var i;
        for (i = 0; i < apis.length; ++i) {
          var api = apis[i];
          api.call('runConsoleCommand', 'permissions player addgroup ' + data.username + ' donator');
        }
      });
      
      socket.on('disconnect', function() {
        streams.removeListeners(socket.id);
        realtime.removeConnectedUser(socket);
        clearInterval(statusInterval);
      });
    });
  });
};