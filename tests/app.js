var vows = require('vows'),
  assert = require('assert'),
  sinon = require('sinon'),
  internalapi = require('../internalapi'),
  realtime = require('../realtime');


var suite = vows.describe('Realtime server').addBatch({
  'The server': {
    topic: function() {
      var getServers = sinon.stub(internalapi, 'getServers', function(callback) {
        callback(null, {
          servers: []
        });
      });

      realtime.init(this.callback);

      getServers.restore();
    },
    'should start': function(err) {
      assert.isUndefined(err);
      realtime.start();
    }
  }
}).export(module, {error: false});
