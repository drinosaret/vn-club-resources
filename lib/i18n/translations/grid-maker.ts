const en = {
  // GridMakerContent
  'page.title': 'Visual Novel 3x3 Maker',
  'page.subtitle': 'Create and share a collage of your favorite visual novels or characters. Import from VNDB, drag to arrange, crop covers, and export as a high-res image.',

  // GridBoard: toolbar
  'toolbar.vnMode': 'Visual novels mode',
  'toolbar.vns': 'VNs',
  'toolbar.charMode': 'Characters mode',
  'toolbar.characters': 'Characters',
  'toolbar.squareCrop': 'Square crop',
  'toolbar.coverAspect': 'Cover aspect ratio',
  'toolbar.import': 'Import',
  'toolbar.clear': 'Clear',

  // GridBoard: import form
  'import.placeholder': 'VNDB username or ID...',
  'import.button': 'Import',
  'import.lookingUp': 'Looking up user...',
  'import.fetchingPage': 'Fetching page {page}...',
  'import.userNotFound': 'User "{username}" not found.',
  'import.noScored': 'No scored VNs found for this user.',
  'import.failed': 'Import failed.',
  'import.confirmReplace': 'This will replace your current grid. Continue?',
  'import.loadingBanner': "Loading {user}\u2019s top VNs...",

  // GridBoard: export controls
  'export.titlePlaceholder': 'Title (optional)',
  'export.countVNs': '{count} / {total} VNs',
  'export.countChars': '{count} / {total} characters',
  'export.displaySettings': 'Settings',
  'export.export': 'Export',
  'export.exportScale': 'Export resolution (1x, 1.5x or 2x)',
  'export.shareText': 'My {size}x{size} VN {mode}grid',
  'export.shareTextChar': 'character ',
  'export.shareHashtags': '#VNGrid #VNClub',

  // Share link messages
  'share.linkCopied': 'Link copied!',
  'share.rateLimited': 'Too many requests - please wait a minute',
  'share.createFailed': 'Failed to create link',

  // GridBoard: settings dropdown
  'settings.frame': 'Frame',
  'settings.scores': 'Show scores',
  'settings.nsfw': 'Reveal NSFW',
  'settings.titles': 'Show titles',
  'settings.directAdd': 'Add directly to grid',
  'settings.language': 'Language',
  'settings.titleHeight': 'Title height',

  // GridBoard: grid hints
  'grid.hintVNs': 'Click empty cells to add VNs. Drag covers to reorder. Auto-saved.',
  'grid.hintChars': 'Click empty cells to add characters. Drag covers to reorder. Auto-saved.',
  'grid.tryTierList': 'Try the Tier List',
  'grid.tryRoulette': 'Try the Roulette',

  // GridBoard: confirm dialogs
  'confirm.modeSwitch': 'Switching modes will clear your current grid. Continue?',
  'confirm.gridShrink': 'Shrinking the grid will remove some items. Continue?',
  'confirm.clearAll': 'Clear all items?',

  // GridSearch
  'search.cellTargetVNs': 'Search VNs for cell {n} by title or ID...',
  'search.cellTargetChars': 'Search characters for cell {n} by name, title or ID...',
  'search.charsPlaceholder': 'Search characters by name, title or VNDB ID (e.g. c123)...',
  'search.vnsPlaceholder': 'Search VNs by title or VNDB ID (e.g. v17)...',
  'search.added': 'Added',
  'search.capacityPlaceholder': 'Grid is at capacity (500 VNs)',
  'search.charsCapacityPlaceholder': 'Grid is at capacity (500 characters)',
  'search.error': 'Search unavailable. Try again.',
  'search.noResults': 'No results found',

  // Storage
  'storage.warning': 'Could not save changes - browser storage is full. Export or share your grid to avoid losing work.',

  // CropModal
  'crop.editTitle': 'Edit: {title}',
  'crop.resetAutoTitle': 'Reset to auto title',
  'crop.scorePlaceholder': 'Score (10\u2013100)',
  'crop.clearScore': 'Clear score',
  'crop.resetCrop': 'Reset crop',
  'crop.cancel': 'Cancel',
  'crop.save': 'Save',

  // GridCell
  'cell.empty': 'Add to cell {n}, row {row} column {col}',
  'cell.edit': 'Edit',
  'cell.remove': 'Remove',

  // Pool
  'pool.label': 'Unranked',
  'pool.pin': 'Pin pool',
  'pool.unpin': 'Unpin pool',
  'pool.emptyHint': 'Search to add VNs',
  'pool.emptyHintChars': 'Search to add characters',

  // Import destination
  'import.toPool': 'Add to pool',
  'import.autoFill': 'Auto-fill grid',
} as const;

type GridMakerKeys = keyof typeof en;

const ja: Record<GridMakerKeys, string> = {
  // GridMakerContent
  'page.title': '\u30a8\u30ed\u30b2 3x3\u30e1\u30fc\u30ab\u30fc',
  'page.subtitle': 'お気に入りのエロゲやキャラクターのコラージュを作成・共有。VNDBからインポート、ドラッグで並べ替え、カバーをクロップして高解像度画像としてエクスポート。',

  // GridBoard: toolbar
  'toolbar.vnMode': '\u30a8\u30ed\u30b2\u30e2\u30fc\u30c9',
  'toolbar.vns': 'エロゲ',
  'toolbar.charMode': '\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u30e2\u30fc\u30c9',
  'toolbar.characters': '\u30ad\u30e3\u30e9',
  'toolbar.squareCrop': '\u6b63\u65b9\u5f62\u30af\u30ed\u30c3\u30d7',
  'toolbar.coverAspect': '\u30ab\u30d0\u30fc\u30a2\u30b9\u30da\u30af\u30c8\u6bd4',
  'toolbar.import': '\u30a4\u30f3\u30dd\u30fc\u30c8',
  'toolbar.clear': '\u30af\u30ea\u30a2',

  // GridBoard: import form
  'import.placeholder': 'VNDB\u30e6\u30fc\u30b6\u30fc\u540d\u307e\u305f\u306fID...',
  'import.button': '\u30a4\u30f3\u30dd\u30fc\u30c8',
  'import.lookingUp': '\u30e6\u30fc\u30b6\u30fc\u3092\u691c\u7d22\u4e2d...',
  'import.fetchingPage': '\u30da\u30fc\u30b8{page}\u3092\u53d6\u5f97\u4e2d...',
  'import.userNotFound': '\u30e6\u30fc\u30b6\u30fc\u300c{username}\u300d\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002',
  'import.noScored': '\u3053\u306e\u30e6\u30fc\u30b6\u30fc\u306b\u306f\u30b9\u30b3\u30a2\u4ed8\u304d\u4f5c\u54c1\u304c\u3042\u308a\u307e\u305b\u3093\u3002',
  'import.failed': '\u30a4\u30f3\u30dd\u30fc\u30c8\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002',
  'import.confirmReplace': '\u73fe\u5728\u306e\u30b0\u30ea\u30c3\u30c9\u304c\u7f6e\u304d\u63db\u3048\u3089\u308c\u307e\u3059\u3002\u7d9a\u884c\u3057\u307e\u3059\u304b\uff1f',
  'import.loadingBanner': '{user}\u306e\u30c8\u30c3\u30d7\u4f5c\u54c1\u3092\u8aad\u307f\u8fbc\u307f\u4e2d...',

  // GridBoard: export controls
  'export.titlePlaceholder': '\u30bf\u30a4\u30c8\u30eb\uff08\u4efb\u610f\uff09',
  'export.countVNs': '{count} / {total} 作品',
  'export.countChars': '{count} / {total} \u30ad\u30e3\u30e9',
  'export.displaySettings': '\u8a2d\u5b9a',
  'export.export': '\u30a8\u30af\u30b9\u30dd\u30fc\u30c8',
  'export.exportScale': 'エクスポート解像度 (1x／1.5x／2x)',
  'export.shareText': '私の{size}x{size}{mode}グリッド',
  'export.shareTextChar': 'キャラ',
  'export.shareHashtags': '#VNGrid #VNClub',

  // Share link messages
  'share.linkCopied': 'リンクをコピーしました！',
  'share.rateLimited': 'リクエストが多すぎます。少々お待ちください',
  'share.createFailed': 'リンクの作成に失敗しました',

  // GridBoard: settings dropdown
  'settings.frame': '\u30d5\u30ec\u30fc\u30e0',
  'settings.scores': '\u30b9\u30b3\u30a2\u3092\u8868\u793a',
  'settings.nsfw': 'NSFW\u3092\u8868\u793a',
  'settings.titles': '\u30bf\u30a4\u30c8\u30eb\u3092\u8868\u793a',
  'settings.directAdd': '\u30b0\u30ea\u30c3\u30c9\u306b\u76f4\u63a5\u8ffd\u52a0',
  'settings.language': '\u8a00\u8a9e',
  'settings.titleHeight': '\u30bf\u30a4\u30c8\u30eb\u306e\u9ad8\u3055',

  // GridBoard: grid hints
  'grid.hintVNs': '空のセルをクリックしてエロゲを追加。カバーをドラッグして並べ替え。自動保存。',
  'grid.hintChars': '\u7a7a\u306e\u30bb\u30eb\u3092\u30af\u30ea\u30c3\u30af\u3057\u3066\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u3092\u8ffd\u52a0\u3002\u30ab\u30d0\u30fc\u3092\u30c9\u30e9\u30c3\u30b0\u3057\u3066\u4e26\u3079\u66ff\u3048\u3002\u81ea\u52d5\u4fdd\u5b58\u3002',
  'grid.tryTierList': '\u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u3092\u8a66\u3059',
  'grid.tryRoulette': '\u30eb\u30fc\u30ec\u30c3\u30c8\u3092\u8a66\u3059',

  // GridBoard: confirm dialogs
  'confirm.modeSwitch': '\u30e2\u30fc\u30c9\u3092\u5207\u308a\u66ff\u3048\u308b\u3068\u73fe\u5728\u306e\u30b0\u30ea\u30c3\u30c9\u304c\u30af\u30ea\u30a2\u3055\u308c\u307e\u3059\u3002\u7d9a\u884c\u3057\u307e\u3059\u304b\uff1f',
  'confirm.gridShrink': '\u30b0\u30ea\u30c3\u30c9\u3092\u7e2e\u5c0f\u3059\u308b\u3068\u4e00\u90e8\u306e\u30a2\u30a4\u30c6\u30e0\u304c\u524a\u9664\u3055\u308c\u307e\u3059\u3002\u7d9a\u884c\u3057\u307e\u3059\u304b\uff1f',
  'confirm.clearAll': '\u3059\u3079\u3066\u306e\u30a2\u30a4\u30c6\u30e0\u3092\u30af\u30ea\u30a2\u3057\u307e\u3059\u304b\uff1f',

  // GridSearch
  'search.cellTargetVNs': 'セル{n}のエロゲをタイトルまたはIDで検索...',
  'search.cellTargetChars': 'セル{n}のキャラクターを名前・作品名・IDで検索...',
  'search.charsPlaceholder': 'キャラクター名・作品名・VNDB IDで検索 (例: c123)...',
  'search.vnsPlaceholder': '\u30bf\u30a4\u30c8\u30eb\u307e\u305f\u306fVNDB ID\u3067\u691c\u7d22 (\u4f8b: v17)...',
  'search.added': '\u8ffd\u52a0\u6e08\u307f',
  'search.capacityPlaceholder': '\u30b0\u30ea\u30c3\u30c9\u304c\u5b9a\u54e1\u306b\u9054\u3057\u307e\u3057\u305f\uff08500 \u4f5c\u54c1\uff09',
  'search.charsCapacityPlaceholder': '\u30b0\u30ea\u30c3\u30c9\u304c\u5b9a\u54e1\u306b\u9054\u3057\u307e\u3057\u305f\uff08500 \u30ad\u30e3\u30e9\uff09',
  'search.error': '検索に失敗しました。もう一度お試しください。',
  'search.noResults': '結果が見つかりませんでした',

  // Storage
  'storage.warning': '変更を保存できませんでした。ブラウザのストレージがいっぱいです。データを失わないよう、エクスポートまたは共有してください。',

  // CropModal
  'crop.editTitle': '\u7de8\u96c6: {title}',
  'crop.resetAutoTitle': '\u81ea\u52d5\u30bf\u30a4\u30c8\u30eb\u306b\u623b\u3059',
  'crop.scorePlaceholder': '\u30b9\u30b3\u30a2 (10\u2013100)',
  'crop.clearScore': '\u30b9\u30b3\u30a2\u3092\u30af\u30ea\u30a2',
  'crop.resetCrop': '\u30af\u30ed\u30c3\u30d7\u3092\u30ea\u30bb\u30c3\u30c8',
  'crop.cancel': '\u30ad\u30e3\u30f3\u30bb\u30eb',
  'crop.save': '\u4fdd\u5b58',

  // GridCell
  'cell.empty': 'セル{n}（{row}行{col}列）に追加',
  'cell.edit': '\u7de8\u96c6',
  'cell.remove': '\u524a\u9664',

  // Pool
  'pool.label': '未分類',
  'pool.pin': 'プールを固定',
  'pool.unpin': 'プールの固定を解除',
  'pool.emptyHint': 'エロゲを検索して追加',
  'pool.emptyHintChars': 'キャラを検索して追加',

  // Import destination
  'import.toPool': '\u30d7\u30fc\u30eb\u306b\u8ffd\u52a0',
  'import.autoFill': '\u30b0\u30ea\u30c3\u30c9\u306b\u81ea\u52d5\u914d\u7f6e',
};

export const gridMakerStrings = { en, ja };
