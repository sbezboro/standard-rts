exports.htmlEncode = function(text) {
    return text.replace('<', '&lt;').replace('>', '&gt;');
}