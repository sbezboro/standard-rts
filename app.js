var realtime = require('./realtime')
  , logger = require('./logger');

var main = function() {
  realtime.init(function(error) {
    if (error) {
      logger.error(error);
      logger.info('Could not connect to API for server info, retrying in 1 second');
      setTimeout(main, 1000);
      return;
    }
    
    realtime.start();
  });
};

main();