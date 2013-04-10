var app = require('./app');

var LOG_LENGTH = 500;

var streamSources = ['console', 'connections'];
var streamListeners = {};
var streamStart = {};

var log = {};

function startStream(id, source) {
  var api = app.apis[id];
  
  streamStart[id][source] = new Date().getTime() / 1000;
  
  api.stream(source, function(error, data) {
    var listeners = streamListeners[id][source];
    
    if (error) {
      listeners.map(function(listener) {
        listener.callback(error);
      });
      
      console.log("Stream error for source '" + source + "' and server id " + id + ", retrying in 2 seconds");
      setTimeout(function() {
        startStream(id, source);
      }, 2000);
    } else {
      if (data.success.time < streamStart[id][source]) {
        return;
      }
      
      listeners.map(function(listener) {
        listener.callback(null, data);
      });
      
      log[id][source].push(data);
      if (log[id][source].length > LOG_LENGTH) {
        log[id][source].shift();
      }
    }
  });
}

exports.startStreams = function() {
  for (id in app.apis) {
    streamListeners[id] = {};
    streamStart[id] = {};
    log[id] = {};
    
    streamSources.map(function(source) {
      streamListeners[id][source] = [];
      log[id][source] = [];
      
      startStream(id, source);
    });
  }
}

exports.addListener = function(socketId, serverId, source, callback) {
  streamListeners[serverId][source].push({
    socketId: socketId,
    callback: callback
  });
  
  if (source != 'connections') {
    log[serverId][source].map(function(data) {
      callback(null, data);
    });
  }
}

exports.removeListeners = function(socketId) {
  for (id in app.apis) {
    streamSources.map(function(source) {
      var listeners = streamListeners[id][source];
      
      var i = listeners.length;
      while (i--) {
        if (listeners[i].socketId == socketId) {
          listeners.splice(i, 1);
        } 
      }
    });
  }
}