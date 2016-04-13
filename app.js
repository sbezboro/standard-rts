var realtime = require('./realtime')
  , config = require('./config')
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

    logger.info('Realtime server started on port ' + config.port);
  });
};

main();