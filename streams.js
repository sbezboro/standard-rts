var realtime = require('./realtime');

var LOG_LENGTH = 500;

var streamSources = ['console', 'connections'];
var streamListeners = {};
var streamStart = {};

var log = {};

function startStream(id, source) {
  var api = realtime.apis[id];
  
  streamStart[id][source] = new Date().getTime() / 1000;
  
  api.stream(source, function(error, data) {
    var listeners = streamListeners[id][source];
    
    if (error) {
      var i;
      for (i = 0; i < listeners.length; ++i) {
        var listener = listeners[i];
        listener.callback(error);
      }
      
      console.log("Stream error for source '" + source + "' and server id " + id + ", retrying in 2 seconds");
      setTimeout(function() {
        startStream(id, source);
      }, 2000);
    } else {
      if (data.success.time < streamStart[id][source]) {
        return;
      }
      
      var i;
      for (i = 0; i < listeners.length; ++i) {
        var listener = listeners[i];
        listener.callback(null, {
          one: data.success
        });
      }
      
      log[id][source].push(data.success.line);
      if (log[id][source].length > LOG_LENGTH) {
        log[id][source].shift();
      }
    }
  });
}

exports.startStreams = function() {
  var id;
  for (id in realtime.apis) {
    streamListeners[id] = {};
    streamStart[id] = {};
    log[id] = {};
    
    var i;
    for (i = 0; i < streamSources.length; ++i) {
      var source = streamSources[i];
      streamListeners[id][source] = [];
      log[id][source] = [];
      
      startStream(id, source);
    }
  }
}

exports.addListener = function(socketId, serverId, source, callback) {
  streamListeners[serverId][source].push({
    socketId: socketId,
    callback: callback
  });
  
  if (source != 'connections') {
    var batch = log[serverId][source].slice(0);
    callback(null, {
      'batch': batch
    })
  }
}

exports.removeListeners = function(socketId) {
  var id;
  for (id in realtime.apis) {
    var i;
    for (i = 0; i < streamSources.length; ++i) {
      var source = streamSources[i];
      var listeners = streamListeners[id][source];
      
      var j = listeners.length;
      while (j--) {
        if (listeners[j].socketId == socketId) {
          listeners.splice(j, 1);
          return;
        } 
      }
    }
  }
}