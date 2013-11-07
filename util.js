var ansitohtml = require('ansi-to-html');

exports.htmlEncode = function(text) {
    return text.replace('<', '&lt;').replace('>', '&gt;');
}

exports.ansiConvert = new ansitohtml();