var ansitohtml = require('ansi-to-html');

exports.htmlEncode = function(text) {
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// temporary workaround
// maps section sign codes to real ansi codes, as paperspigot doesn't seem to include jansi in the runtime
var _ansi_mc_map = {
    "\xa70": "\x1B[0;30;22m", // Black 0
    "\xa71": "\x1B[0;34;22m", // Dark Blue 1
    "\xa72": "\x1B[0;32;22m", // Dark Green 2
    "\xa73": "\x1B[0;36;22m", // Dark Aqua 3
    "\xa74": "\x1B[0;31;22m", // Dark Red 4
    "\xa75": "\x1B[0;35;22m", // Dark Purple 5
    "\xa76": "\x1B[0;33;22m", // Gold 6
    "\xa77": "\x1B[0;37;22m", // Gray 7
    "\xa78": "\x1B[0;30;1m",  // Dark Gray 8
    "\xa79": "\x1B[0;34;1m",  // Blue 9
    "\xa7a": "\x1B[0;32;1m",  // Green a
    "\xa7b": "\x1B[0;36;1m",  // Aqua b
    "\xa7c": "\x1B[0;31;1m",  // Red c
    "\xa7d": "\x1B[0;35;1m",  // Light Purple d
    "\xa7e": "\x1B[0;33;1m",  // Yellow e
    "\xa7f": "\x1B[0;37;1m",  // White f
    "\xa7k": "\x1B[5m",       // Obfuscated k
    "\xa7l": "\x1B[21m",      // Bold l
    "\xa7m": "\x1B[9m",       // Strikethrough m
    "\xa7n": "\x1B[4m",       // Underline n
    "\xa7o": "\x1B[3m",       // Italic o
    "\xa7r": "\x1B[39;0m",    // Reset r
}

var _ansitohtml = new ansitohtml();

exports.ansiConvert = {
    toHtml: function(line) {
        var converted = line;

        for (var code in _ansi_mc_map) {
            converted = converted.replace(code, _ansi_mc_map[code])
        }

        return _ansitohtml.toHtml(line)
    }
}
