const en = {
  'page.title': 'VN Roulette Wheel',
  'page.subtitle': 'Add visual novels to the wheel and spin to pick your next read',

  'mode.solo': 'Solo',
  'mode.group': 'Group',

  'sidebar.vnCount': 'Visual Novels ({count}/{max})',
  'sidebar.searchPlaceholder': 'Search VNs by name or ID...',
  'sidebar.searchCapacity': 'Wheel is full (15 max)',
  'sidebar.emptyHint': 'Search and add VNs to build your wheel',
  'sidebar.clearAll': 'Clear all',

  'players.title': 'Players ({remaining}/{total} remaining)',
  'players.addPlaceholder': 'Add player name...',
  'players.addButton': 'Add',
  'players.emptyHint': 'Add player names to assign VNs',
  'players.resetAssignments': 'Reset assignments',

  'spin.button': 'Spin!',
  'spin.spinning': 'Spinning...',
  'spin.spinningFor': 'Spinning for',
  'spin.spinAgain': 'Spin Again',
  'spin.nextPlayer': 'Next Player',
  'spin.assignLast': 'Assign Last',

  'result.reads': 'reads:',
  'result.rating': 'Rating: {rating}',
  'result.viewDetails': 'View details',
  'result.allAssigned': 'All players assigned!',
  'result.resetAndGoAgain': 'Reset and go again',

  'wheel.emptyText': 'Add VNs to start',

  'assignments.title': 'Assignments',
  'assignments.reset': 'Reset',
  'assignments.colRound': '#',
  'assignments.colPlayer': 'Player',
  'assignments.colVN': 'Visual Novel',

  'settings.removeOnPick': 'Remove from wheel after picked',
  'settings.playerOrder': 'Pick players in order',

  'sidebar.added': 'Added',
  'sidebar.searchError': 'Search failed. Try again.',

  'crosslink.tryTierList': 'Try the Tier List',
  'crosslink.try3x3': 'Try the 3x3 Maker',
} as const;

const ja = {
  'page.title': '\u30a8\u30ed\u30b2\u30eb\u30fc\u30ec\u30c3\u30c8',
  'page.subtitle': '\u30a8\u30ed\u30b2\u3092\u30db\u30a4\u30fc\u30eb\u306b\u8ffd\u52a0\u3057\u3066\u30b9\u30d4\u30f3\u3067\u6b21\u306e\u4e00\u4f5c\u3092\u9078\u3073\u307e\u3057\u3087\u3046',

  'mode.solo': '\u30bd\u30ed',
  'mode.group': '\u30b0\u30eb\u30fc\u30d7',

  'sidebar.vnCount': '\u30a8\u30ed\u30b2 ({count}/{max})',
  'sidebar.searchPlaceholder': '\u30bf\u30a4\u30c8\u30eb\u307e\u305f\u306fID\u3067\u691c\u7d22...',
  'sidebar.searchCapacity': '\u30db\u30a4\u30fc\u30eb\u304c\u6e80\u676f\u3067\u3059\uff0815\u4ef6\u307e\u3067\uff09',
  'sidebar.emptyHint': '\u30a8\u30ed\u30b2\u3092\u691c\u7d22\u3057\u3066\u30db\u30a4\u30fc\u30eb\u3092\u4f5c\u308a\u307e\u3057\u3087\u3046',
  'sidebar.clearAll': '\u5168\u3066\u30af\u30ea\u30a2',

  'players.title': '\u30d7\u30ec\u30a4\u30e4\u30fc ({remaining}/{total} \u6b8b\u308a)',
  'players.addPlaceholder': '\u30d7\u30ec\u30a4\u30e4\u30fc\u540d\u3092\u8ffd\u52a0...',
  'players.addButton': '\u8ffd\u52a0',
  'players.emptyHint': '\u30d7\u30ec\u30a4\u30e4\u30fc\u540d\u3092\u8ffd\u52a0\u3057\u3066VN\u3092\u5272\u308a\u5f53\u3066',
  'players.resetAssignments': '\u5272\u308a\u5f53\u3066\u3092\u30ea\u30bb\u30c3\u30c8',

  'spin.button': '\u30b9\u30d4\u30f3\uff01',
  'spin.spinning': '\u30b9\u30d4\u30f3\u4e2d...',
  'spin.spinningFor': '\u30b9\u30d4\u30f3\u4e2d:',
  'spin.spinAgain': '\u3082\u3046\u4e00\u5ea6\u30b9\u30d4\u30f3',
  'spin.nextPlayer': '\u6b21\u306e\u30d7\u30ec\u30a4\u30e4\u30fc',
  'spin.assignLast': '\u6700\u5f8c\u3092\u5272\u308a\u5f53\u3066',

  'result.reads': '\u306e\u62c5\u5f53:',
  'result.rating': '\u8a55\u4fa1: {rating}',
  'result.viewDetails': '\u8a73\u7d30\u3092\u898b\u308b',
  'result.allAssigned': '\u5168\u54e1\u5272\u308a\u5f53\u3066\u5b8c\u4e86\uff01',
  'result.resetAndGoAgain': '\u30ea\u30bb\u30c3\u30c8\u3057\u3066\u3082\u3046\u4e00\u5ea6',

  'wheel.emptyText': '\u30a8\u30ed\u30b2\u3092\u8ffd\u52a0\u3057\u3066\u958b\u59cb',

  'assignments.title': '\u5272\u308a\u5f53\u3066\u5c65\u6b74',
  'assignments.reset': '\u30ea\u30bb\u30c3\u30c8',
  'assignments.colRound': '#',
  'assignments.colPlayer': '\u30d7\u30ec\u30a4\u30e4\u30fc',
  'assignments.colVN': '\u30a8\u30ed\u30b2',

  'settings.removeOnPick': '\u9078\u3070\u308c\u305f\u3089\u30db\u30a4\u30fc\u30eb\u304b\u3089\u524a\u9664',
  'settings.playerOrder': '\u30d7\u30ec\u30a4\u30e4\u30fc\u3092\u9806\u756a\u306b\u9078\u3076',

  'sidebar.added': '\u8ffd\u52a0\u6e08\u307f',
  'sidebar.searchError': '\u691c\u7d22\u306b\u5931\u6557\u3057\u307e\u3057\u305f',

  'crosslink.tryTierList': '\u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u3092\u8a66\u3059',
  'crosslink.try3x3': '3x3\u30e1\u30fc\u30ab\u30fc\u3092\u8a66\u3059',
} as const;

export const rouletteStrings = { en, ja };
