var cache = require('../cache');

var getCacheKey = function(uuid) {
  return 'nickname-' + uuid;
};

exports.getNickname = function(uuid, callback) {
  cache.get(getCacheKey(uuid), function(err, nickname) {
    if (err) {
      return callback(err);
    }

    callback(err, nickname);
  });
};

exports.setNickname = function(uuid, nickname) {
  cache.set(getCacheKey(uuid), nickname, 86400);
};
