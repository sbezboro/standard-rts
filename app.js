var realtime = require('./realtime')
  , config = require('./config');

realtime.init(config, function(error) {
  if (error) {
    console.log(error);
    process.kill();
  }
  
  realtime.start();
});