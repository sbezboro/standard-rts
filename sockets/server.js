exports.getStatus = function(api, socket, showIPs) {
  api.call('server_status', function(error, data) {
    if (!error && data.success) {
      data = data.success;
      
      for (var i = 0; i < data.players.length; ++i) {
        // Don't expose player IP addresses to clients
        if (!showIPs) {
          delete data.players[i].address;
        }
      }
      
      delete data.banned_players;
      
      socket.emit('server-status', {
        players: data.players,
        numPlayers: data.numplayers,
        maxPlayers: data.maxplayers,
        load: data.load,
        tps: data.tps
      });
    }
  });
};

exports.handleStreamData = function(error, data, socket, name, lastError, prepareLine) {
  if (error) {
    if (!lastError) {
      lastError = error;
      socket.emit('mc-connection-lost');
    }
    return;
  } else {
    if (lastError) {
      socket.emit('mc-connection-restored');
    }
    lastError = null;
  }
  
  if (data.one) {
    var line = prepareLine(data.one.line);
    
    if (line) {
      socket.emit(name, {
        line: line
      });
    }
  } else if (data.batch) {
    var i = data.batch.length;
    while (i--) {
      var line = prepareLine(data.batch[i]);
      
      if (line) {
        data.batch[i] = line;
      } else {
        data.batch.splice(i, 1);
      }
    }
    
    socket.emit(name, {
      batch: data.batch
    });
  }
};