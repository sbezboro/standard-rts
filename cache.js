var Memcached = require('memcached')
  , config = require('./config');

var memcached = new Memcached(
  config.memcached.urls,
  config.memcached.options
);

exports.get = function(key, callback) {
  memcached.get(key, function(err, data) {
    callback(err, data);
  });
};

exports.set = function(key, value, lifetime, callback) {
  memcached.set(key, value, lifetime, function(err) {
    if (callback) {
      callback(err);
    }
  });
};
