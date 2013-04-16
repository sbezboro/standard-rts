var realtime = require('./realtime')
  , config = require('./config');

realtime.init(config);

realtime.start();