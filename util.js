var ansitohtml = require('ansi-to-html');

exports.htmlEncode = function(text) {
    return text.replace('<', '&lt;').replace('>', '&gt;').replace('/', '&#47;');
}

var ansiConvert = new ansitohtml();
exports.ansiConvert = ansiConvert;