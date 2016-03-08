exports.API_CALL_RESULTS = {
  'ok': 0,
  'exception': 1,
  'not_handled': 2,
  'banned': 3,
  'muted': 4,
  'never_joined': 5
};

exports.PLAYER_PROPERTY_WHITELIST = [
  'username',
  'nickname',
  'nickname_ansi',
  'rank',
  'time_spent'
];

exports.PLAYER_PROPERTY_MODERATOR_WHITELIST = [
  'address',
  'username',
  'nickname',
  'nickname_ansi',
  'rank',
  'time_spent'
];
