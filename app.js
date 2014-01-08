var realtime = require('./realtime')
  , logger = require('./logger')
  , config = require('./config');

if (process.argv.length > 2) {
  config.port = process.argv[2];
}

var main = function() {
  realtime.init(config, function(error) {
    if (error) {
      logger.error(error);
      logger.info('Retrying in 1 second');
      setTimeout(main, 1000);
      return;
    }
    
    realtime.start();
  });
}

main();