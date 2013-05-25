var realtime = require('./realtime')
  , config = require('./config');

if (process.argv.length > 2) {
  config.port = process.argv[2];
}

realtime.init(config, function(error) {
  if (error) {
    console.log(error);
    process.kill();
  }
  
  realtime.start();
});