var config = require('./config');
var request = require('request');


var getUrl = function(apiPath) {
  return 'http://' + config.website + '/api/v1/' + apiPath;
};

var getHeaders = function(userId) {
  var headers = {
    'Content-Type': 'application/json',
    'X-Standard-Secret': config.authSecret
  };

  if (userId) {
    headers['X-Standard-User-Id'] = userId;
  }

  return headers;
};

exports.rtsUserConnection = function(userId) {
  var options = {
    uri: getUrl('rts_user_connection'),
    headers: getHeaders(userId)
  };

  request(options, function(error, response, body) {
    if (error || response.statusCode != 200) {
      console.log(error);
    }
  });
};

exports.getPlayerData = function(userId, callback) {
  var options = {
    uri: getUrl('get_player_data'),
    headers: getHeaders(userId)
  };

  request(options, function(error, response, body) {
    if (error || response.statusCode != 200) {
      console.log(error);
      return callback(error);
    }

    callback(null, JSON.parse(body));
  });
};
