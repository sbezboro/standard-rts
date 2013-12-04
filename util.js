var ansitohtml = require('ansi-to-html');

exports.htmlEncode = function(text) {
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

exports.ansiConvert = new ansitohtml();