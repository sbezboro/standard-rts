var realtime = require('./realtime')
  , config = require('./config');

var realtimeServer = new realtime.RealtimeServer();

realtimeServer.init(config);

realtimeServer.start();