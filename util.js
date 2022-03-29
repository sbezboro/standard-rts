var ansitohtml = require('ansi-to-html');

exports.htmlEncode = function(text) {
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// temporary workaround
// maps section sign codes to real ansi codes, as paperspigot doesn't seem to include jansi in the runtime
var _ansi_mc_map = {
    "§0": "\x1B[0;30;22m", // Black 0
    "§1": "\x1B[0;34;22m", // Dark Blue 1
    "§2": "\x1B[0;32;22m", // Dark Green 2
    "§3": "\x1B[0;36;22m", // Dark Aqua 3
    "§4": "\x1B[0;31;22m", // Dark Red 4
    "§5": "\x1B[0;35;22m", // Dark Purple 5
    "§6": "\x1B[0;33;22m", // Gold 6
    "§7": "\x1B[0;37;22m", // Gray 7
    "§8": "\x1B[0;30;1m",  // Dark Gray 8
    "§9": "\x1B[0;34;1m",  // Blue 9
    "§a": "\x1B[0;32;1m",  // Green a
    "§b": "\x1B[0;36;1m",  // Aqua b
    "§c": "\x1B[0;31;1m",  // Red c
    "§d": "\x1B[0;35;1m",  // Light Purple d
    "§e": "\x1B[0;33;1m",  // Yellow e
    "§f": "\x1B[0;37;1m",  // White f
    "§k": "\x1B[5m",       // Obfuscated k
    "§l": "\x1B[21m",      // Bold l
    "§m": "\x1B[9m",       // Strikethrough m
    "§n": "\x1B[4m",       // Underline n
    "§o": "\x1B[3m",       // Italic o
    "§r": "\x1B[39;0m",    // Reset r
    "\x7f0": "\x1B[0;30;22m", // Black 0
    "\x7f1": "\x1B[0;34;22m", // Dark Blue 1
    "\x7f2": "\x1B[0;32;22m", // Dark Green 2
    "\x7f3": "\x1B[0;36;22m", // Dark Aqua 3
    "\x7f4": "\x1B[0;31;22m", // Dark Red 4
    "\x7f5": "\x1B[0;35;22m", // Dark Purple 5
    "\x7f6": "\x1B[0;33;22m", // Gold 6
    "\x7f7": "\x1B[0;37;22m", // Gray 7
    "\x7f8": "\x1B[0;30;1m",  // Dark Gray 8
    "\x7f9": "\x1B[0;34;1m",  // Blue 9
    "\x7fa": "\x1B[0;32;1m",  // Green a
    "\x7fb": "\x1B[0;36;1m",  // Aqua b
    "\x7fc": "\x1B[0;31;1m",  // Red c
    "\x7fd": "\x1B[0;35;1m",  // Light Purple d
    "\x7fe": "\x1B[0;33;1m",  // Yellow e
    "\x7ff": "\x1B[0;37;1m",  // White f
    "\x7fk": "\x1B[5m",       // Obfuscated k
    "\x7fl": "\x1B[21m",      // Bold l
    "\x7fm": "\x1B[9m",       // Strikethrough m
    "\x7fn": "\x1B[4m",       // Underline n
    "\x7fo": "\x1B[3m",       // Italic o
    "\x7fr": "\x1B[39;0m",    // Reset r
}

var _ansi_mc_map_regexp = {};
for (var code in _ansi_mc_map) {
    _ansi_mc_map_regexp[code] = new RegExp(code, 'gi');
}

var _ansitohtml = new ansitohtml();

exports.ansiConvert = {
    toHtml: function(line) {
        for (var code in _ansi_mc_map) {
            line = line.replace(_ansi_mc_map_regexp[code], _ansi_mc_map[code])
        }

        return _ansitohtml.toHtml(line)
    }
}