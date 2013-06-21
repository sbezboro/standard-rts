var realtime = require('./realtime')
  , config = require('./config');

if (process.argv.length > 2) {
  config.port = process.argv[2];
}

var main = function() {
  realtime.init(config, function(error) {
    if (error) {
      console.log(error);
      console.log('Retrying in 1 second');
      setTimeout(main, 1000);
      return;
    }
    
    realtime.start();
  });
}

main();