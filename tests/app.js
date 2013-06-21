var vows = require('vows'),
  assert = require('assert'),
  realtime = require('../realtime');

var config = {
  website: 'standardsurvival.com'
};

var suite = vows.describe('Realtime server').addBatch({
  'The server': {
    topic: function() {
      realtime.init(config, this.callback);
    },
    'should start': function(err) {
      assert.isUndefined(err);
      realtime.start();
    }
  }
}).export(module, {error: false});