var winston = require('winston');

var logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({
      timestamp: true,
      colorize: true
    })
  ],
  exitOnError: false
});

module.exports = logger;
