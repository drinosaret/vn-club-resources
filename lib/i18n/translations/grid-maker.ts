const en = {
  // GridMakerContent
  'page.title': 'Visual Novel 3x3 Maker',
  'page.subtitle': 'Create and share a collage of your favorite visual novels or characters. Import from VNDB, drag to arrange, crop covers, and export as a high-res image.',

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
  'export.exportScale': 'Export resolution (1x or 2x)',
  'export.shareText': 'My {size}x{size} VN {mode}grid',
  'export.shareTextChar': 'character ',
  'export.shareHashtags': '#VNGrid #VNClub',

  // Share link messages
  'share.linkCopied': 'Link copied!',
  'share.rateLimited': 'Too many requests - please wait a minute',
  'share.createFailed': 'Failed to create link',

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
  'search.capacityPlaceholder': 'Grid is at capacity (500 VNs)',
  'search.charsCapacityPlaceholder': 'Grid is at capacity (500 characters)',
  'search.error': 'Search unavailable. Try again.',
  'search.noResults': 'No results found',

  // Storage
  'storage.warning': 'Could not save changes - browser storage is full. Export or share your grid to avoid losing work.',

  // CropModal
  'crop.editTitle': 'Edit \u2014 {title}',
  'crop.editTitlePrefix': 'Edit \u2014 ',
  'crop.viewOnSite': 'View on VN Club',
  'crop.viewOnVndb': 'View on VNDB',
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
  'howItWorks.adding.body': 'Search for visual novels or characters by name or VNDB ID (e.g. \u201cv17\u201d or \u201c17\u201d). Click a result to add it to the pool, or enable \u201cAdd directly to grid\u201d in the cogwheel to place items into the next empty cell. You can also click an empty cell first, then search within the modal to target that specific slot. Switch between VN and character mode with the toggle buttons. To bulk-import, enter your VNDB username or user ID and your top 500 highest-scored titles fill the grid automatically. The grid holds up to 500 items total (grid cells + pool).',
  'howItWorks.gridSize.title': 'Grid size and layout',
  'howItWorks.gridSize.body': 'Choose between 3\u00d73, 4\u00d74, or 5\u00d75 grids. Switch between square crop and cover (2:3) aspect ratios. Drag and drop items to rearrange them; dragging swaps the positions of two cells. Items that don\u2019t fit on the grid stay in the pool below, ready to be dragged in whenever you want.',
  'howItWorks.cropping.title': 'Cropping and editing',
  'howItWorks.cropping.body': 'Hover over any item and click the pencil icon to open the editor. Use the zoom slider (1x\u20133x) and drag to reposition the crop area. You can also set a custom title, adjust the vote score (10\u2013100), or pick a different cover image. The preview updates in real time.',
  'howItWorks.titles.title': 'Display settings',
  'howItWorks.titles.body': 'Open the cogwheel to toggle title overlays, score badges, the decorative frame, and title language (EN/JP). Titles appear at the bottom of each cell and scores show as a badge in the corner. These settings apply to both the on-screen view and the exported image.',
  'howItWorks.exporting.title': 'Exporting and sharing',
  'howItWorks.exporting.body': 'Export your grid as JPG, PNG, or WebP, copy it to your clipboard, or share it directly via Twitter, Reddit, or your device\u2019s native share menu. You can also generate a shareable link. Anyone who opens it gets a copy they can edit, making it a great way to send friends a template to fill out with their own picks from the same pool of VNs. Set a title using the text field above the grid and it appears as a header in the export. NSFW covers are blurred by default. To include them uncensored in the export, either click individual covers to reveal them or enable \u201cReveal NSFW\u201d from the cogwheel (this is the same setting as the site-wide \u201cShow NSFW uncensored\u201d toggle). The export captures your current display settings: titles, scores, crops, language, and dark/light theme.',
  'howItWorks.autoSave.title': 'Auto-save',
  'howItWorks.autoSave.body': 'Your grid is saved to your browser automatically, including items, crop positions, custom titles, scores, and display settings. If you imported from VNDB, the URL updates so you can bookmark or share it directly.',
} as const;

type GridMakerKeys = keyof typeof en;

const ja: Record<GridMakerKeys, string> = {
  // GridMakerContent
  'page.title': '\u30a8\u30ed\u30b2 3x3\u30e1\u30fc\u30ab\u30fc',
  'page.subtitle': 'お気に入りのエロゲやキャラクターのコラージュを作成・共有。VNDBからインポート、ドラッグで並べ替え、カバーをクロップして高解像度画像としてエクスポート。',

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
  'export.countChars': '{count} / {total} \u30ad\u30e3\u30e9',
  'export.displaySettings': '\u8868\u793a\u8a2d\u5b9a',
  'export.copyImage': '\u30b3\u30d4\u30fc',
  'export.export': '\u30a8\u30af\u30b9\u30dd\u30fc\u30c8',
  'export.exportScale': 'エクスポート解像度 (1xまたは2x)',
  'export.shareText': '私の{size}x{size}{mode}グリッド',
  'export.shareTextChar': 'キャラ',
  'export.shareHashtags': '#VNGrid #VNClub',

  // Share link messages
  'share.linkCopied': 'リンクをコピーしました！',
  'share.rateLimited': 'リクエストが多すぎます。少々お待ちください',
  'share.createFailed': 'リンクの作成に失敗しました',

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
  'search.capacityPlaceholder': '\u30b0\u30ea\u30c3\u30c9\u304c\u5b9a\u54e1\u306b\u9054\u3057\u307e\u3057\u305f\uff08500 \u4f5c\u54c1\uff09',
  'search.charsCapacityPlaceholder': '\u30b0\u30ea\u30c3\u30c9\u304c\u5b9a\u54e1\u306b\u9054\u3057\u307e\u3057\u305f\uff08500 \u30ad\u30e3\u30e9\uff09',
  'search.error': '検索に失敗しました。もう一度お試しください。',
  'search.noResults': '結果が見つかりませんでした',

  // Storage
  'storage.warning': '変更を保存できませんでした。ブラウザのストレージがいっぱいです。データを失わないよう、エクスポートまたは共有してください。',

  // CropModal
  'crop.editTitle': '\u7de8\u96c6 \u2014 {title}',
  'crop.editTitlePrefix': '\u7de8\u96c6 \u2014 ',
  'crop.viewOnSite': 'VN Club\u3067\u898b\u308b',
  'crop.viewOnVndb': 'VNDB\u3067\u898b\u308b',
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
  'pool.label': '未分類',
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
  'howItWorks.adding.body': '\u691c\u7d22\u30d0\u30fc\u3067\u30a8\u30ed\u30b2\u3084\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u3092\u540d\u524d\u3084VNDB ID\uff08\u4f8b\uff1a\u300cv17\u300d\u3084\u300c17\u300d\uff09\u3067\u691c\u7d22\u3067\u304d\u307e\u3059\u3002\u30af\u30ea\u30c3\u30af\u3059\u308b\u3068\u30d7\u30fc\u30eb\u306b\u8ffd\u52a0\u3055\u308c\u307e\u3059\u3002\u6b6f\u8eca\u30a2\u30a4\u30b3\u30f3\u306e\u300c\u30b0\u30ea\u30c3\u30c9\u306b\u76f4\u63a5\u8ffd\u52a0\u300d\u3092\u6709\u52b9\u306b\u3059\u308b\u3068\u3001\u6b21\u306e\u7a7a\u306e\u30bb\u30eb\u306b\u76f4\u63a5\u914d\u7f6e\u3055\u308c\u307e\u3059\u3002\u7a7a\u306e\u30bb\u30eb\u3092\u5148\u306b\u30af\u30ea\u30c3\u30af\u3057\u3066\u3001\u30e2\u30fc\u30c0\u30eb\u5185\u3067\u691c\u7d22\u3057\u3066\u7279\u5b9a\u306e\u30b9\u30ed\u30c3\u30c8\u3092\u30bf\u30fc\u30b2\u30c3\u30c8\u3059\u308b\u3053\u3068\u3082\u53ef\u80fd\u3002\u30a8\u30ed\u30b2/\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u30e2\u30fc\u30c9\u306f\u30c8\u30b0\u30eb\u30dc\u30bf\u30f3\u3067\u5207\u308a\u66ff\u3048\u3002VNDB\u306e\u30e6\u30fc\u30b6\u30fc\u540d\u307e\u305f\u306fID\u3092\u5165\u529b\u3059\u308b\u3068\u3001\u8a55\u4fa1\u306e\u9ad8\u3044\u4e0a\u4f4d500\u4f5c\u54c1\u304c\u81ea\u52d5\u7684\u306b\u30b0\u30ea\u30c3\u30c9\u306b\u914d\u7f6e\u3055\u308c\u307e\u3059\u3002\u30b0\u30ea\u30c3\u30c9\u306b\u306f\u5408\u8a08500\u30a2\u30a4\u30c6\u30e0\uff08\u30bb\u30eb\uff0b\u30d7\u30fc\u30eb\uff09\u307e\u3067\u4fdd\u6301\u3067\u304d\u307e\u3059\u3002',
  'howItWorks.gridSize.title': '\u30b0\u30ea\u30c3\u30c9\u30b5\u30a4\u30ba\u3068\u30ec\u30a4\u30a2\u30a6\u30c8',
  'howItWorks.gridSize.body': '3\u00d73\u30014\u00d74\u30015\u00d75\u306e\u30b0\u30ea\u30c3\u30c9\u304b\u3089\u9078\u629e\u3067\u304d\u307e\u3059\u3002\u6b63\u65b9\u5f62\u30af\u30ed\u30c3\u30d7\u3068\u30ab\u30d0\u30fc\uff082:3\uff09\u30a2\u30b9\u30da\u30af\u30c8\u6bd4\u3092\u5207\u308a\u66ff\u3048\u53ef\u80fd\u3002\u30a2\u30a4\u30c6\u30e0\u3092\u30c9\u30e9\u30c3\u30b0\uff06\u30c9\u30ed\u30c3\u30d7\u3067\u4e26\u3079\u66ff\u3048\u3089\u308c\u3001\u30c9\u30e9\u30c3\u30b0\u3059\u308b\u30682\u3064\u306e\u30bb\u30eb\u306e\u4f4d\u7f6e\u304c\u5165\u308c\u66ff\u308f\u308a\u307e\u3059\u3002\u30b0\u30ea\u30c3\u30c9\u306b\u53ce\u307e\u3089\u306a\u3044\u30a2\u30a4\u30c6\u30e0\u306f\u4e0b\u306e\u30d7\u30fc\u30eb\u306b\u4fdd\u7ba1\u3055\u308c\u3001\u3044\u3064\u3067\u3082\u30c9\u30e9\u30c3\u30b0\u3067\u30b0\u30ea\u30c3\u30c9\u306b\u623b\u305b\u307e\u3059\u3002',
  'howItWorks.cropping.title': '\u30af\u30ed\u30c3\u30d7\u3068\u7de8\u96c6',
  'howItWorks.cropping.body': '\u30a2\u30a4\u30c6\u30e0\u306b\u30de\u30a6\u30b9\u3092\u5408\u308f\u305b\u3066\u925b\u7b46\u30a2\u30a4\u30b3\u30f3\u3092\u30af\u30ea\u30c3\u30af\u3059\u308b\u3068\u30a8\u30c7\u30a3\u30bf\u30fc\u304c\u958b\u304d\u307e\u3059\u3002\u30ba\u30fc\u30e0\u30b9\u30e9\u30a4\u30c0\u30fc\uff081x\uff5e3x\uff09\u3068\u30c9\u30e9\u30c3\u30b0\u3067\u30af\u30ed\u30c3\u30d7\u7bc4\u56f2\u3092\u8abf\u6574\u3067\u304d\u307e\u3059\u3002\u30ab\u30b9\u30bf\u30e0\u30bf\u30a4\u30c8\u30eb\u306e\u8a2d\u5b9a\u3001\u30b9\u30b3\u30a2\uff0810\uff5e100\uff09\u306e\u8abf\u6574\u3001\u5225\u306e\u30ab\u30d0\u30fc\u753b\u50cf\u306e\u9078\u629e\u3082\u53ef\u80fd\u3002\u30d7\u30ec\u30d3\u30e5\u30fc\u306f\u30ea\u30a2\u30eb\u30bf\u30a4\u30e0\u3067\u66f4\u65b0\u3055\u308c\u307e\u3059\u3002',
  'howItWorks.titles.title': '\u8868\u793a\u8a2d\u5b9a',
  'howItWorks.titles.body': '\u6b6f\u8eca\u30a2\u30a4\u30b3\u30f3\u3092\u958b\u304f\u3068\u3001\u30bf\u30a4\u30c8\u30eb\u30aa\u30fc\u30d0\u30fc\u30ec\u30a4\u3001\u30b9\u30b3\u30a2\u30d0\u30c3\u30b8\u3001\u88c5\u98fe\u30d5\u30ec\u30fc\u30e0\u3001\u30bf\u30a4\u30c8\u30eb\u8a00\u8a9e\uff08EN/JP\uff09\u3092\u5207\u308a\u66ff\u3048\u3089\u308c\u307e\u3059\u3002\u30bf\u30a4\u30c8\u30eb\u306f\u5404\u30bb\u30eb\u306e\u4e0b\u90e8\u306b\u3001\u30b9\u30b3\u30a2\u306f\u89d2\u306b\u30d0\u30c3\u30b8\u3068\u3057\u3066\u8868\u793a\u3055\u308c\u307e\u3059\u3002\u3053\u308c\u3089\u306e\u8a2d\u5b9a\u306f\u753b\u9762\u8868\u793a\u3068\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u753b\u50cf\u306e\u4e21\u65b9\u306b\u9069\u7528\u3055\u308c\u307e\u3059\u3002',
  'howItWorks.exporting.title': '\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3068\u5171\u6709',
  'howItWorks.exporting.body': 'JPG\u3001PNG\u3001WebP\u3067\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3001\u30af\u30ea\u30c3\u30d7\u30dc\u30fc\u30c9\u306b\u30b3\u30d4\u30fc\u3001\u307e\u305f\u306fTwitter\u3001Reddit\u3001\u30c7\u30d0\u30a4\u30b9\u306e\u5171\u6709\u30e1\u30cb\u30e5\u30fc\u3067\u76f4\u63a5\u5171\u6709\u3067\u304d\u307e\u3059\u3002\u5171\u6709\u30ea\u30f3\u30af\u3092\u751f\u6210\u3059\u308b\u3068\u3001\u958b\u3044\u305f\u4eba\u304c\u30b3\u30d4\u30fc\u3092\u7de8\u96c6\u3067\u304d\u308b\u306e\u3067\u3001\u53cb\u4eba\u306b\u30c6\u30f3\u30d7\u30ec\u30fc\u30c8\u3068\u3057\u3066\u9001\u308a\u3001\u540c\u3058\u4f5c\u54c1\u30d7\u30fc\u30eb\u304b\u3089\u81ea\u5206\u306e\u30d4\u30c3\u30af\u3092\u57cb\u3081\u3066\u3082\u3089\u3046\u4f7f\u3044\u65b9\u304c\u3067\u304d\u307e\u3059\u3002\u30b0\u30ea\u30c3\u30c9\u4e0a\u306e\u30c6\u30ad\u30b9\u30c8\u30d5\u30a3\u30fc\u30eb\u30c9\u3067\u30bf\u30a4\u30c8\u30eb\u3092\u8a2d\u5b9a\u3059\u308b\u3068\u3001\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u753b\u50cf\u306e\u30d8\u30c3\u30c0\u30fc\u306b\u8868\u793a\u3055\u308c\u307e\u3059\u3002NSFW\u30ab\u30d0\u30fc\u306f\u30c7\u30d5\u30a9\u30eb\u30c8\u3067\u30d6\u30e9\u30fc\u3055\u308c\u307e\u3059\u3002\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3067\u7121\u4fee\u6b63\u306b\u3059\u308b\u306b\u306f\u3001\u500b\u5225\u306e\u30ab\u30d0\u30fc\u3092\u30af\u30ea\u30c3\u30af\u3057\u3066\u8868\u793a\u3059\u308b\u304b\u3001\u6b6f\u8eca\u30a2\u30a4\u30b3\u30f3\u304b\u3089\u300cNSFW\u3092\u8868\u793a\u300d\u3092\u6709\u52b9\u306b\u3057\u3066\u304f\u3060\u3055\u3044\uff08\u30b5\u30a4\u30c8\u5168\u4f53\u306e\u300cNSFW\u3092\u7121\u4fee\u6b63\u3067\u8868\u793a\u300d\u3068\u540c\u3058\u8a2d\u5b9a\u3067\u3059\uff09\u3002\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u306f\u73fe\u5728\u306e\u8868\u793a\u8a2d\u5b9a\uff08\u30bf\u30a4\u30c8\u30eb\u3001\u30b9\u30b3\u30a2\u3001\u30af\u30ed\u30c3\u30d7\u3001\u8a00\u8a9e\u3001\u30c6\u30fc\u30de\uff09\u3092\u53cd\u6620\u3057\u307e\u3059\u3002',
  'howItWorks.autoSave.title': '\u81ea\u52d5\u4fdd\u5b58',
  'howItWorks.autoSave.body': '\u30b0\u30ea\u30c3\u30c9\u306f\u30a2\u30a4\u30c6\u30e0\u3001\u30af\u30ed\u30c3\u30d7\u4f4d\u7f6e\u3001\u30ab\u30b9\u30bf\u30e0\u30bf\u30a4\u30c8\u30eb\u3001\u30b9\u30b3\u30a2\u3001\u8868\u793a\u8a2d\u5b9a\u3092\u542b\u3081\u3066\u30d6\u30e9\u30a6\u30b6\u306b\u81ea\u52d5\u4fdd\u5b58\u3055\u308c\u307e\u3059\u3002VNDB\u304b\u3089\u30a4\u30f3\u30dd\u30fc\u30c8\u3057\u305f\u5834\u5408\u3001URL\u304c\u66f4\u65b0\u3055\u308c\u308b\u306e\u3067\u30d6\u30c3\u30af\u30de\u30fc\u30af\u3084\u5171\u6709\u306b\u4fbf\u5229\u3067\u3059\u3002',
};

export const gridMakerStrings = { en, ja };
