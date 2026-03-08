const en = {
  // GridMakerContent
  'page.title': 'Visual Novel 3x3 Maker',
  'page.subtitle': 'Create a collage of your top visual novels or characters. Import from your VNDB list or search manually, then export as a shareable image.',

  // GridBoard — toolbar
  'toolbar.vnMode': 'Visual novels mode',
  'toolbar.vns': 'VNs',
  'toolbar.charMode': 'Characters mode',
  'toolbar.characters': 'Characters',
  'toolbar.squareCrop': 'Square crop',
  'toolbar.coverAspect': 'Cover aspect ratio',
  'toolbar.import': 'Import',
  'toolbar.clear': 'Clear',

  // GridBoard — import form
  'import.placeholder': 'VNDB username or ID...',
  'import.button': 'Import',
  'import.lookingUp': 'Looking up user...',
  'import.fetchingPage': 'Fetching page {page}...',
  'import.userNotFound': 'User "{username}" not found.',
  'import.noScored': 'No scored VNs found for this user.',
  'import.failed': 'Import failed.',
  'import.confirmReplace': 'This will replace your current grid. Continue?',
  'import.loadingBanner': "Loading {user}\u2019s top VNs...",

  // GridBoard — export controls
  'export.titlePlaceholder': 'Title (optional)',
  'export.countVNs': '{count} / {total} VNs',
  'export.countChars': '{count} / {total} characters',
  'export.displaySettings': 'Display settings',
  'export.copyImage': 'Copy',
  'export.export': 'Export',
  'export.shareText': 'My {size}x{size} VN {mode}grid',
  'export.shareTextChar': 'character ',
  'export.shareHashtags': '#VNGrid #VNClub',

  // GridBoard — settings dropdown
  'settings.frame': 'Frame',
  'settings.scores': 'Show scores',
  'settings.nsfw': 'Reveal NSFW',
  'settings.titles': 'Show titles',
  'settings.directAdd': 'Add directly to grid',
  'settings.language': 'Language',
  'settings.titleHeight': 'Title height',

  // GridBoard — grid hints
  'grid.hintVNs': 'Click empty cells to add VNs. Drag covers to reorder. Auto-saved.',
  'grid.hintChars': 'Click empty cells to add characters. Drag covers to reorder. Auto-saved.',
  'grid.tryTierList': 'Try the Tier List',

  // GridBoard — confirm dialogs
  'confirm.modeSwitch': 'Switching modes will clear your current grid. Continue?',
  'confirm.gridShrink': 'Shrinking the grid will remove some items. Continue?',
  'confirm.clearAll': 'Clear all items?',

  // GridSearch
  'search.gridFull': 'Grid is full',
  'search.cellTargetVNs': 'Search VNs for cell {n}...',
  'search.cellTargetChars': 'Search characters for cell {n}...',
  'search.charsPlaceholder': 'Search characters to add...',
  'search.vnsPlaceholder': 'Search VNs by title or VNDB ID (e.g. v17)...',
  'search.added': 'Added',
  'search.error': 'Search unavailable. Try again.',
  'search.noResults': 'No results found',

  // Storage
  'storage.warning': 'Could not save changes - browser storage is full. Export or share your grid to avoid losing work.',

  // CropModal
  'crop.editTitle': 'Edit \u2014 {title}',
  'crop.resetAutoTitle': 'Reset to auto title',
  'crop.scorePlaceholder': 'Score (10\u2013100)',
  'crop.clearScore': 'Clear score',
  'crop.resetCrop': 'Reset crop',
  'crop.cancel': 'Cancel',
  'crop.save': 'Save',

  // GridCell
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

  // How it works
  'howItWorks.title': 'How it works',
  'howItWorks.adding.title': 'Adding items',
  'howItWorks.adding.body': 'Use the search bar to find visual novels or characters by name or VNDB ID (e.g. \u201cv17\u201d or \u201c17\u201d). Click a result to add it to the next empty cell, or click a specific empty cell first to target that slot. Switch between VN and character mode with the toggle buttons. You can also import your top-rated VNs from VNDB by entering your username or user ID, and the grid fills automatically with your highest-scored titles.',
  'howItWorks.gridSize.title': 'Grid size and layout',
  'howItWorks.gridSize.body': 'Choose between 3\u00d73, 4\u00d74, or 5\u00d75 grids. Switch between square crop and cover (2:3) aspect ratios. Drag and drop items to rearrange them. Dragging swaps the positions of two cells. If you shrink the grid size, items outside the new bounds are removed.',
  'howItWorks.cropping.title': 'Cropping images',
  'howItWorks.cropping.body': 'Hover over any item and click the pencil icon to open the crop editor. Use the zoom slider to zoom in (1x\u20133x), then drag the image to position the crop area exactly where you want it. Hit reset to return to the default center position. The crop preview updates in real time so you can see exactly how it\u2019ll look in the grid.',
  'howItWorks.titles.title': 'Custom titles and scores',
  'howItWorks.titles.body': 'The crop editor also lets you set a custom title to override the default name, and adjust the vote score (10\u2013100). Use the controls to toggle title overlays and score badges on or off. Titles appear as a bar at the bottom of each cell, and scores show as a badge in the top-left corner. The EN/JP toggle switches between English/romaji and Japanese titles across the entire grid.',
  'howItWorks.exporting.title': 'Exporting and sharing',
  'howItWorks.exporting.body': 'Export your finished grid as a high-resolution PNG image, copy it to your clipboard, or share it directly via Twitter, Reddit, or your device\u2019s native share menu. You can set a title for your grid using the text field in the controls bar, and it will appear as a header in the exported image. Toggle the frame option to add spacing between cells in the exported image. Use the NSFW checkbox to reveal blurred covers for the export. The export respects your current display settings, so titles, scores, crop positions, language preference, and dark/light theme are all captured.',
  'howItWorks.autoSave.title': 'Auto-save',
  'howItWorks.autoSave.body': 'Your grid is saved to your browser automatically as you work, including items, crop positions, custom titles, scores, and your imported username. If you imported from VNDB, the URL updates so you can share the link directly and others will see the same import.',
} as const;

type GridMakerKeys = keyof typeof en;

const ja: Record<GridMakerKeys, string> = {
  // GridMakerContent
  'page.title': '\u30a8\u30ed\u30b2 3x3\u30e1\u30fc\u30ab\u30fc',
  'page.subtitle': '\u304a\u6c17\u306b\u5165\u308a\u306e\u30a8\u30ed\u30b2\u3084\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u306e\u30b3\u30e9\u30fc\u30b8\u30e5\u3092\u4f5c\u6210\u3002VNDB\u30ea\u30b9\u30c8\u304b\u3089\u30a4\u30f3\u30dd\u30fc\u30c8\u3059\u308b\u304b\u3001\u624b\u52d5\u3067\u691c\u7d22\u3057\u3066\u3001\u5171\u6709\u53ef\u80fd\u306a\u753b\u50cf\u3068\u3057\u3066\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3002',

  // GridBoard — toolbar
  'toolbar.vnMode': '\u30a8\u30ed\u30b2\u30e2\u30fc\u30c9',
  'toolbar.vns': 'エロゲ',
  'toolbar.charMode': '\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u30e2\u30fc\u30c9',
  'toolbar.characters': '\u30ad\u30e3\u30e9',
  'toolbar.squareCrop': '\u6b63\u65b9\u5f62\u30af\u30ed\u30c3\u30d7',
  'toolbar.coverAspect': '\u30ab\u30d0\u30fc\u30a2\u30b9\u30da\u30af\u30c8\u6bd4',
  'toolbar.import': '\u30a4\u30f3\u30dd\u30fc\u30c8',
  'toolbar.clear': '\u30af\u30ea\u30a2',

  // GridBoard — import form
  'import.placeholder': 'VNDB\u30e6\u30fc\u30b6\u30fc\u540d\u307e\u305f\u306fID...',
  'import.button': '\u30a4\u30f3\u30dd\u30fc\u30c8',
  'import.lookingUp': '\u30e6\u30fc\u30b6\u30fc\u3092\u691c\u7d22\u4e2d...',
  'import.fetchingPage': '\u30da\u30fc\u30b8{page}\u3092\u53d6\u5f97\u4e2d...',
  'import.userNotFound': '\u30e6\u30fc\u30b6\u30fc\u300c{username}\u300d\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002',
  'import.noScored': '\u3053\u306e\u30e6\u30fc\u30b6\u30fc\u306b\u306f\u30b9\u30b3\u30a2\u4ed8\u304d\u4f5c\u54c1\u304c\u3042\u308a\u307e\u305b\u3093\u3002',
  'import.failed': '\u30a4\u30f3\u30dd\u30fc\u30c8\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002',
  'import.confirmReplace': '\u73fe\u5728\u306e\u30b0\u30ea\u30c3\u30c9\u304c\u7f6e\u304d\u63db\u3048\u3089\u308c\u307e\u3059\u3002\u7d9a\u884c\u3057\u307e\u3059\u304b\uff1f',
  'import.loadingBanner': '{user}\u306e\u30c8\u30c3\u30d7\u4f5c\u54c1\u3092\u8aad\u307f\u8fbc\u307f\u4e2d...',

  // GridBoard — export controls
  'export.titlePlaceholder': '\u30bf\u30a4\u30c8\u30eb\uff08\u4efb\u610f\uff09',
  'export.countVNs': '{count} / {total} 作品',
  'export.countChars': '{count} / {total} \u30ad\u30e3\u30e9\u30af\u30bf\u30fc',
  'export.displaySettings': '\u8868\u793a\u8a2d\u5b9a',
  'export.copyImage': '\u30b3\u30d4\u30fc',
  'export.export': '\u30a8\u30af\u30b9\u30dd\u30fc\u30c8',
  'export.shareText': '私の{size}x{size} エロゲ {mode}グリッド',
  'export.shareTextChar': 'キャラクター',
  'export.shareHashtags': '#エロゲグリッド #VNClub',

  // GridBoard — settings dropdown
  'settings.frame': '\u30d5\u30ec\u30fc\u30e0',
  'settings.scores': '\u30b9\u30b3\u30a2\u3092\u8868\u793a',
  'settings.nsfw': 'NSFW\u3092\u8868\u793a',
  'settings.titles': '\u30bf\u30a4\u30c8\u30eb\u3092\u8868\u793a',
  'settings.directAdd': '\u30b0\u30ea\u30c3\u30c9\u306b\u76f4\u63a5\u8ffd\u52a0',
  'settings.language': '\u8a00\u8a9e',
  'settings.titleHeight': '\u30bf\u30a4\u30c8\u30eb\u306e\u9ad8\u3055',

  // GridBoard — grid hints
  'grid.hintVNs': '空のセルをクリックしてエロゲを追加。カバーをドラッグして並べ替え。自動保存。',
  'grid.hintChars': '\u7a7a\u306e\u30bb\u30eb\u3092\u30af\u30ea\u30c3\u30af\u3057\u3066\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u3092\u8ffd\u52a0\u3002\u30ab\u30d0\u30fc\u3092\u30c9\u30e9\u30c3\u30b0\u3057\u3066\u4e26\u3079\u66ff\u3048\u3002\u81ea\u52d5\u4fdd\u5b58\u3002',
  'grid.tryTierList': '\u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u3092\u8a66\u3059',

  // GridBoard — confirm dialogs
  'confirm.modeSwitch': '\u30e2\u30fc\u30c9\u3092\u5207\u308a\u66ff\u3048\u308b\u3068\u73fe\u5728\u306e\u30b0\u30ea\u30c3\u30c9\u304c\u30af\u30ea\u30a2\u3055\u308c\u307e\u3059\u3002\u7d9a\u884c\u3057\u307e\u3059\u304b\uff1f',
  'confirm.gridShrink': '\u30b0\u30ea\u30c3\u30c9\u3092\u7e2e\u5c0f\u3059\u308b\u3068\u4e00\u90e8\u306e\u30a2\u30a4\u30c6\u30e0\u304c\u524a\u9664\u3055\u308c\u307e\u3059\u3002\u7d9a\u884c\u3057\u307e\u3059\u304b\uff1f',
  'confirm.clearAll': '\u3059\u3079\u3066\u306e\u30a2\u30a4\u30c6\u30e0\u3092\u30af\u30ea\u30a2\u3057\u307e\u3059\u304b\uff1f',

  // GridSearch
  'search.gridFull': '\u30b0\u30ea\u30c3\u30c9\u304c\u6e80\u676f\u3067\u3059',
  'search.cellTargetVNs': 'セル{n}のエロゲを検索...',
  'search.cellTargetChars': '\u30bb\u30eb{n}\u306e\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u3092\u691c\u7d22...',
  'search.charsPlaceholder': '\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u3092\u691c\u7d22...',
  'search.vnsPlaceholder': '\u30bf\u30a4\u30c8\u30eb\u307e\u305f\u306fVNDB ID\u3067\u691c\u7d22 (\u4f8b: v17)...',
  'search.added': '\u8ffd\u52a0\u6e08\u307f',
  'search.error': '検索できません。もう一度お試しください。',
  'search.noResults': '結果が見つかりませんでした',

  // Storage
  'storage.warning': '変更を保存できませんでした。ブラウザのストレージがいっぱいです。データを失わないよう、エクスポートまたは共有してください。',

  // CropModal
  'crop.editTitle': '\u7de8\u96c6 \u2014 {title}',
  'crop.resetAutoTitle': '\u81ea\u52d5\u30bf\u30a4\u30c8\u30eb\u306b\u623b\u3059',
  'crop.scorePlaceholder': '\u30b9\u30b3\u30a2 (10\u2013100)',
  'crop.clearScore': '\u30b9\u30b3\u30a2\u3092\u30af\u30ea\u30a2',
  'crop.resetCrop': '\u30af\u30ed\u30c3\u30d7\u3092\u30ea\u30bb\u30c3\u30c8',
  'crop.cancel': '\u30ad\u30e3\u30f3\u30bb\u30eb',
  'crop.save': '\u4fdd\u5b58',

  // GridCell
  'cell.edit': '\u7de8\u96c6',
  'cell.remove': '\u524a\u9664',

  // Pool
  'pool.label': '未ランク',
  'pool.pin': 'プールを固定',
  'pool.unpin': 'プールの固定を解除',
  'pool.emptyHint': 'エロゲを検索して追加',
  'pool.emptyHintChars': 'キャラを検索して追加',

  // Import destination
  'import.toPool': '\u30d7\u30fc\u30eb\u306b\u8ffd\u52a0',
  'import.autoFill': '\u30b0\u30ea\u30c3\u30c9\u306b\u81ea\u52d5\u914d\u7f6e',

  // How it works
  'howItWorks.title': '\u4f7f\u3044\u65b9',
  'howItWorks.adding.title': '\u30a2\u30a4\u30c6\u30e0\u306e\u8ffd\u52a0',
  'howItWorks.adding.body': '\u691c\u7d22\u30d0\u30fc\u3092\u4f7f\u3063\u3066\u30a8\u30ed\u30b2\u3084\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u3092\u540d\u524d\u3084VNDB ID\uff08\u4f8b\uff1a\u300cv17\u300d\u3084\u300c17\u300d\uff09\u3067\u691c\u7d22\u3067\u304d\u307e\u3059\u3002\u691c\u7d22\u7d50\u679c\u3092\u30af\u30ea\u30c3\u30af\u3059\u308b\u3068\u6b21\u306e\u7a7a\u306e\u30bb\u30eb\u306b\u8ffd\u52a0\u3055\u308c\u307e\u3059\u3002\u7279\u5b9a\u306e\u7a7a\u306e\u30bb\u30eb\u3092\u5148\u306b\u30af\u30ea\u30c3\u30af\u3059\u308b\u3068\u3001\u305d\u306e\u30b9\u30ed\u30c3\u30c8\u3092\u30bf\u30fc\u30b2\u30c3\u30c8\u3067\u304d\u307e\u3059\u3002エロゲ\u30e2\u30fc\u30c9\u3068\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u30e2\u30fc\u30c9\u306f\u30c8\u30b0\u30eb\u30dc\u30bf\u30f3\u3067\u5207\u308a\u66ff\u3048\u53ef\u80fd\u3002VNDB\u306e\u30e6\u30fc\u30b6\u30fc\u540d\u307e\u305f\u306fID\u3092\u5165\u529b\u3059\u308b\u3068\u3001\u8a55\u4fa1\u306e\u9ad8\u3044エロゲ\u304c\u81ea\u52d5\u7684\u306b\u30b0\u30ea\u30c3\u30c9\u306b\u8ffd\u52a0\u3055\u308c\u307e\u3059\u3002',
  'howItWorks.gridSize.title': '\u30b0\u30ea\u30c3\u30c9\u30b5\u30a4\u30ba\u3068\u30ec\u30a4\u30a2\u30a6\u30c8',
  'howItWorks.gridSize.body': '3\u00d73\u30014\u00d74\u30015\u00d75\u306e\u30b0\u30ea\u30c3\u30c9\u304b\u3089\u9078\u629e\u3067\u304d\u307e\u3059\u3002\u6b63\u65b9\u5f62\u30af\u30ed\u30c3\u30d7\u3068\u30ab\u30d0\u30fc\uff082:3\uff09\u30a2\u30b9\u30da\u30af\u30c8\u6bd4\u3092\u5207\u308a\u66ff\u3048\u53ef\u80fd\u3002\u30a2\u30a4\u30c6\u30e0\u3092\u30c9\u30e9\u30c3\u30b0\uff06\u30c9\u30ed\u30c3\u30d7\u3067\u4e26\u3079\u66ff\u3048\u3089\u308c\u307e\u3059\u3002\u30c9\u30e9\u30c3\u30b0\u3059\u308b\u30682\u3064\u306e\u30bb\u30eb\u306e\u4f4d\u7f6e\u304c\u5165\u308c\u66ff\u308f\u308a\u307e\u3059\u3002\u30b0\u30ea\u30c3\u30c9\u3092\u7e2e\u5c0f\u3059\u308b\u3068\u3001\u7bc4\u56f2\u5916\u306e\u30a2\u30a4\u30c6\u30e0\u306f\u524a\u9664\u3055\u308c\u307e\u3059\u3002',
  'howItWorks.cropping.title': '\u753b\u50cf\u306e\u30af\u30ed\u30c3\u30d7',
  'howItWorks.cropping.body': '\u30a2\u30a4\u30c6\u30e0\u306b\u30de\u30a6\u30b9\u3092\u5408\u308f\u305b\u3066\u925b\u7b46\u30a2\u30a4\u30b3\u30f3\u3092\u30af\u30ea\u30c3\u30af\u3059\u308b\u3068\u3001\u30af\u30ed\u30c3\u30d7\u30a8\u30c7\u30a3\u30bf\u30fc\u304c\u958b\u304d\u307e\u3059\u3002\u30ba\u30fc\u30e0\u30b9\u30e9\u30a4\u30c0\u30fc\u3067\u62e1\u5927\uff081x\uff5e3x\uff09\u3057\u3001\u753b\u50cf\u3092\u30c9\u30e9\u30c3\u30b0\u3057\u3066\u30af\u30ed\u30c3\u30d7\u7bc4\u56f2\u3092\u8abf\u6574\u3067\u304d\u307e\u3059\u3002\u30ea\u30bb\u30c3\u30c8\u3092\u62bc\u3059\u3068\u30c7\u30d5\u30a9\u30eb\u30c8\u306e\u4e2d\u592e\u4f4d\u7f6e\u306b\u623b\u308a\u307e\u3059\u3002\u30d7\u30ec\u30d3\u30e5\u30fc\u306f\u30ea\u30a2\u30eb\u30bf\u30a4\u30e0\u3067\u66f4\u65b0\u3055\u308c\u307e\u3059\u3002',
  'howItWorks.titles.title': '\u30ab\u30b9\u30bf\u30e0\u30bf\u30a4\u30c8\u30eb\u3068\u30b9\u30b3\u30a2',
  'howItWorks.titles.body': '\u30af\u30ed\u30c3\u30d7\u30a8\u30c7\u30a3\u30bf\u30fc\u3067\u306f\u30ab\u30b9\u30bf\u30e0\u30bf\u30a4\u30c8\u30eb\u306e\u8a2d\u5b9a\u3084\u30b9\u30b3\u30a2\uff0810\uff5e100\uff09\u306e\u8abf\u6574\u3082\u53ef\u80fd\u3067\u3059\u3002\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb\u3067\u30bf\u30a4\u30c8\u30eb\u30aa\u30fc\u30d0\u30fc\u30ec\u30a4\u3084\u30b9\u30b3\u30a2\u30d0\u30c3\u30b8\u306e\u8868\u793a\u30fb\u975e\u8868\u793a\u3092\u5207\u308a\u66ff\u3048\u3089\u308c\u307e\u3059\u3002\u30bf\u30a4\u30c8\u30eb\u306f\u5404\u30bb\u30eb\u306e\u4e0b\u90e8\u306b\u3001\u30b9\u30b3\u30a2\u306f\u5de6\u4e0a\u306b\u30d0\u30c3\u30b8\u3068\u3057\u3066\u8868\u793a\u3055\u308c\u307e\u3059\u3002EN/JP\u30c8\u30b0\u30eb\u3067\u82f1\u8a9e/\u30ed\u30fc\u30de\u5b57\u3068\u65e5\u672c\u8a9e\u30bf\u30a4\u30c8\u30eb\u3092\u5207\u308a\u66ff\u3048\u3089\u308c\u307e\u3059\u3002',
  'howItWorks.exporting.title': '\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3068\u5171\u6709',
  'howItWorks.exporting.body': '\u5b8c\u6210\u3057\u305f\u30b0\u30ea\u30c3\u30c9\u3092\u9ad8\u89e3\u50cf\u5ea6PNG\u753b\u50cf\u3068\u3057\u3066\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3001\u30af\u30ea\u30c3\u30d7\u30dc\u30fc\u30c9\u306b\u30b3\u30d4\u30fc\u3001\u307e\u305f\u306fTwitter\u3001Reddit\u3001\u30c7\u30d0\u30a4\u30b9\u306e\u5171\u6709\u30e1\u30cb\u30e5\u30fc\u3067\u76f4\u63a5\u5171\u6709\u3067\u304d\u307e\u3059\u3002\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb\u30d0\u30fc\u306e\u30c6\u30ad\u30b9\u30c8\u30d5\u30a3\u30fc\u30eb\u30c9\u3067\u30bf\u30a4\u30c8\u30eb\u3092\u8a2d\u5b9a\u3059\u308b\u3068\u3001\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u753b\u50cf\u306e\u30d8\u30c3\u30c0\u30fc\u306b\u8868\u793a\u3055\u308c\u307e\u3059\u3002\u30d5\u30ec\u30fc\u30e0\u30aa\u30d7\u30b7\u30e7\u30f3\u3067\u30bb\u30eb\u9593\u306b\u30b9\u30da\u30fc\u30b9\u3092\u8ffd\u52a0\u3067\u304d\u307e\u3059\u3002NSFW\u30c1\u30a7\u30c3\u30af\u30dc\u30c3\u30af\u30b9\u3067\u30d6\u30e9\u30fc\u3055\u308c\u305f\u30ab\u30d0\u30fc\u3092\u8868\u793a\u3067\u304d\u307e\u3059\u3002\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u306f\u73fe\u5728\u306e\u8868\u793a\u8a2d\u5b9a\uff08\u30bf\u30a4\u30c8\u30eb\u3001\u30b9\u30b3\u30a2\u3001\u30af\u30ed\u30c3\u30d7\u3001\u8a00\u8a9e\u3001\u30c6\u30fc\u30de\uff09\u3092\u53cd\u6620\u3057\u307e\u3059\u3002',
  'howItWorks.autoSave.title': '\u81ea\u52d5\u4fdd\u5b58',
  'howItWorks.autoSave.body': '\u30b0\u30ea\u30c3\u30c9\u306f\u30d6\u30e9\u30a6\u30b6\u306b\u81ea\u52d5\u7684\u306b\u4fdd\u5b58\u3055\u308c\u307e\u3059\u3002\u30a2\u30a4\u30c6\u30e0\u3001\u30af\u30ed\u30c3\u30d7\u4f4d\u7f6e\u3001\u30ab\u30b9\u30bf\u30e0\u30bf\u30a4\u30c8\u30eb\u3001\u30b9\u30b3\u30a2\u3001\u30a4\u30f3\u30dd\u30fc\u30c8\u3057\u305f\u30e6\u30fc\u30b6\u30fc\u540d\u304c\u4fdd\u6301\u3055\u308c\u307e\u3059\u3002VNDB\u304b\u3089\u30a4\u30f3\u30dd\u30fc\u30c8\u3057\u305f\u5834\u5408\u3001URL\u304c\u66f4\u65b0\u3055\u308c\u308b\u306e\u3067\u30ea\u30f3\u30af\u3092\u76f4\u63a5\u5171\u6709\u3067\u304d\u307e\u3059\u3002',
};

export const gridMakerStrings = { en, ja };
