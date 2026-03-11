const en = {
  // TierListContent
  'page.title': 'Visual Novel Tier List Maker',
  'page.subtitle': 'Rank your visual novels or characters into tiers. Import from VNDB, drag to organize, customize tiers, and export as a shareable image.',

  // TierListBoard — loading banner
  'import.loadingBanner': "Loading {user}\u2019s tier list...",

  // TierListBoard — mode toggle
  'toolbar.vnMode': 'Visual novels mode',
  'toolbar.vns': 'VNs',
  'toolbar.charMode': 'Characters mode',
  'toolbar.characters': 'Characters',
  'confirm.modeSwitch': 'Switching modes will clear your current tier list. Continue?',

  // TierListBoard — toolbar
  'toolbar.coverImages': 'Cover images',
  'toolbar.covers': 'Covers',
  'toolbar.titleNames': 'Title names',
  'toolbar.text': 'Text',
  'toolbar.smallThumbnails': 'Small thumbnails',
  'toolbar.mediumThumbnails': 'Medium thumbnails',
  'toolbar.largeThumbnails': 'Large thumbnails',
  'toolbar.squareCrop': 'Square crop',
  'toolbar.coverAspect': 'Cover aspect ratio',
  'toolbar.preset': '{label} preset',
  'toolbar.import': 'Import',
  'toolbar.addTier': 'Add Tier',
  'toolbar.clear': 'Clear',

  // TierListBoard — import form
  'import.placeholder': 'VNDB username or ID...',
  'import.button': 'Import',
  'import.lookingUp': 'Looking up user...',
  'import.fetchingPage': 'Fetching page {page}...',
  'import.userNotFound': 'User "{username}" not found.',
  'import.noScored': 'No scored VNs found for this user.',
  'import.failed': 'Import failed.',

  // TierListControls
  'controls.titlePlaceholder': 'Title (optional)',
  'controls.vnCount': '{count} VN',
  'controls.vnCountPlural': '{count} VNs',
  'controls.scores': 'Show scores',
  'controls.nsfw': 'Reveal NSFW',
  'controls.titles': 'Show titles',
  'controls.language': 'Language',
  'controls.titleHeight': 'Title height',
  'controls.displaySettings': 'Settings',
  'controls.directAdd': 'Add directly to last tier',
  'controls.copy': 'Copy',
  'controls.export': 'Export',
  'controls.exportScale': 'Export resolution (1x or 2x)',
  'controls.charCount': '{count} Character',
  'controls.charCountPlural': '{count} Characters',
  'controls.shareText': 'My VN tier list',
  'controls.charShareText': 'My character tier list',
  'controls.shareHashtags': '#VNTierList #VNClub',
  'controls.charShareHashtags': '#VNTierList #VNClub',
  'controls.linkCopied': 'Link copied!',
  'controls.rateLimited': 'Too many requests - please wait a minute',
  'controls.createFailed': 'Failed to create link',

  // TierListBoard — hints
  'hint.text': 'Click tier labels to edit. Drag VN covers between tiers. Auto-saved.',
  'hint.textChars': 'Click tier labels to edit. Drag character images between tiers. Auto-saved.',
  'hint.try3x3': 'Try the 3x3 Maker',

  // TierRow
  'tier.dragHere': 'Drag VNs here',
  'tier.dragHereChars': 'Drag characters here',
  'tier.addToTier': 'Add to {tier}',

  // TierRowFillModal
  'tierFill.searchVNs': 'Add VN to {tier}...',
  'tierFill.searchChars': 'Add character to {tier}...',
  'tierFill.vnsPlaceholder': 'Type to search VNs...',
  'tierFill.charsPlaceholder': 'Type to search characters...',

  // TierEditPopover
  'tierEdit.editTier': 'Edit tier',
  'tierEdit.label': 'Label',
  'tierEdit.color': 'Color',
  'tierEdit.deleteTier': 'Delete tier',
  'tierEdit.clearRow': 'Clear row images',
  'tierEdit.moveUp': 'Move row up',
  'tierEdit.moveDown': 'Move row down',
  'tierEdit.addAbove': 'Add a row above',
  'tierEdit.addBelow': 'Add a row below',

  // TierItem
  'tierItem.edit': 'Edit',
  'tierItem.remove': 'Remove',

  // VNEditModal
  'editModal.header': 'Edit \u2014 {title}',
  'editModal.headerPrefix': 'Edit \u2014 ',
  'editModal.viewOnSite': 'View on VN Club',
  'editModal.viewOnVndb': 'View on VNDB',
  'editModal.resetTitle': 'Reset to auto title',
  'editModal.scorePlaceholder': 'Score (10\u2013100)',
  'editModal.clearScore': 'Clear score',
  'editModal.cancel': 'Cancel',
  'editModal.save': 'Save',

  // VNSearchAdd
  'search.capacityPlaceholder': 'Tier list is at capacity (500 VNs)',
  'search.charsCapacityPlaceholder': 'Tier list is at capacity (500 characters)',
  'search.placeholder': 'Search VNs by title or VNDB ID (e.g. v17)...',
  'search.charsPlaceholder': 'Search characters by name...',
  'search.added': 'Added',
  'search.noResults': 'No results found',
  'search.error': 'Search unavailable. Try again.',

  // Storage
  'storage.warning': 'Could not save changes - browser storage is full. Export or share your tier list to avoid losing work.',

  // Pool
  'pool.label': 'Unranked',
  'pool.pin': 'Pin pool',
  'pool.unpin': 'Unpin pool',
  'pool.emptyHint': 'Search to add VNs',
  'pool.emptyHintChars': 'Search to add characters',
  'import.toPool': 'Add to pool',
  'import.autoSort': 'Auto-sort into tiers',

  // How it works
  'howItWorks.title': 'How it works',
  'howItWorks.adding.title': 'Adding items',
  'howItWorks.adding.body': 'Search for visual novels or characters by name or VNDB ID (e.g. \u201cv17\u201d or \u201c17\u201d). Click a result to add it to the unranked pool (or enable \u201cAdd directly to last tier\u201d in the cogwheel to skip the pool). Switch between VN and character mode with the toggle buttons. To bulk-import, enter your VNDB username or user ID and your rated VNs are automatically distributed across tiers based on their scores. The tier list supports up to 500 items.',
  'howItWorks.organizing.title': 'Organizing your tiers',
  'howItWorks.organizing.body': 'Drag an item onto a tier to place it there, or drop it on a specific item to insert before it. Dropping on empty space puts it at the end. Click a tier label to rename it (up to 40 characters), change its color, delete the tier, or add new tiers above or below. Four presets are available (S\u2013F, 1\u20135, 1\u201310, and 10\u2013100), and switching presets redistributes your items automatically.',
  'howItWorks.editing.title': 'Editing scores and titles',
  'howItWorks.editing.body': 'Hover over any item and click the pencil icon to open the edit modal. Set a custom title to override the default, or adjust the vote score (10\u2013100). Use the cogwheel to toggle score badges and title overlays on cover images. The EN/JP toggle switches between English/romaji and Japanese titles across the entire list.',
  'howItWorks.display.title': 'Display modes',
  'howItWorks.display.body': 'Switch between cover image mode and title-only text mode using the toolbar buttons. In cover mode, choose between small, medium, and large thumbnail sizes, and optionally overlay titles and scores. Text mode shows compact labels for a denser view when you have many items.',
  'howItWorks.exporting.title': 'Exporting and sharing',
  'howItWorks.exporting.body': 'Export your tier list as JPG, PNG, or WebP, copy it to your clipboard, or share directly via Twitter, Reddit, or your device\u2019s native share menu. You can also generate a shareable link. Anyone who opens it gets a copy they can rearrange, making it perfect for sending friends a template to rank the same set of VNs. Set a title using the text field above the tiers and it appears as a header in the export. NSFW covers are blurred by default. To include them uncensored in the export, either click individual covers to reveal them or enable \u201cReveal NSFW\u201d from the cogwheel (this is the same setting as the site-wide \u201cShow NSFW uncensored\u201d toggle). The exported image is rendered at 1200px width for consistent quality and captures your current display settings, including thumbnail size, language preference, and dark/light theme.',
  'howItWorks.autoSave.title': 'Auto-save',
  'howItWorks.autoSave.body': 'Everything is saved to your browser automatically: tier layouts, item assignments, custom titles, scores, and display settings. If you imported from VNDB, the URL updates so you can bookmark or share it directly.',
} as const;

type TierListKeys = keyof typeof en;

const ja: Record<TierListKeys, string> = {
  // TierListContent
  'page.title': '\u30a8\u30ed\u30b2 \u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u30e1\u30fc\u30ab\u30fc',
  'page.subtitle': '\u30a8\u30ed\u30b2\u3084\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u3092\u30c6\u30a3\u30a2\u306b\u30e9\u30f3\u30af\u4ed8\u3051\u3002VNDB\u304b\u3089\u30a4\u30f3\u30dd\u30fc\u30c8\u3001\u30c9\u30e9\u30c3\u30b0\u3067\u6574\u7406\u3001\u30c6\u30a3\u30a2\u3092\u30ab\u30b9\u30bf\u30de\u30a4\u30ba\u3057\u3066\u5171\u6709\u53ef\u80fd\u306a\u753b\u50cf\u3068\u3057\u3066\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3002',

  // TierListBoard — loading banner
  'import.loadingBanner': '{user}\u306e\u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u3092\u8aad\u307f\u8fbc\u307f\u4e2d...',

  // TierListBoard — mode toggle
  'toolbar.vnMode': 'エロゲモード',
  'toolbar.vns': 'エロゲ',
  'toolbar.charMode': 'キャラクターモード',
  'toolbar.characters': 'キャラ',
  'confirm.modeSwitch': 'モードを切り替えると現在のティアリストがクリアされます。続行しますか？',

  // TierListBoard — toolbar
  'toolbar.coverImages': '\u30ab\u30d0\u30fc\u753b\u50cf',
  'toolbar.covers': '\u30ab\u30d0\u30fc',
  'toolbar.titleNames': '\u30bf\u30a4\u30c8\u30eb\u540d',
  'toolbar.text': '\u30c6\u30ad\u30b9\u30c8',
  'toolbar.smallThumbnails': '\u5c0f\u30b5\u30e0\u30cd\u30a4\u30eb',
  'toolbar.mediumThumbnails': '\u4e2d\u30b5\u30e0\u30cd\u30a4\u30eb',
  'toolbar.largeThumbnails': '\u5927\u30b5\u30e0\u30cd\u30a4\u30eb',
  'toolbar.squareCrop': '\u6b63\u65b9\u5f62\u30af\u30ed\u30c3\u30d7',
  'toolbar.coverAspect': '\u30ab\u30d0\u30fc\u30a2\u30b9\u30da\u30af\u30c8\u6bd4',
  'toolbar.preset': '{label}\u30d7\u30ea\u30bb\u30c3\u30c8',
  'toolbar.import': '\u30a4\u30f3\u30dd\u30fc\u30c8',
  'toolbar.addTier': '\u30c6\u30a3\u30a2\u8ffd\u52a0',
  'toolbar.clear': '\u30af\u30ea\u30a2',

  // TierListBoard — import form
  'import.placeholder': 'VNDB\u30e6\u30fc\u30b6\u30fc\u540d\u307e\u305f\u306fID...',
  'import.button': '\u30a4\u30f3\u30dd\u30fc\u30c8',
  'import.lookingUp': '\u30e6\u30fc\u30b6\u30fc\u3092\u691c\u7d22\u4e2d...',
  'import.fetchingPage': '\u30da\u30fc\u30b8{page}\u3092\u53d6\u5f97\u4e2d...',
  'import.userNotFound': '\u30e6\u30fc\u30b6\u30fc\u300c{username}\u300d\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002',
  'import.noScored': '\u3053\u306e\u30e6\u30fc\u30b6\u30fc\u306b\u306f\u30b9\u30b3\u30a2\u4ed8\u304d\u4f5c\u54c1\u304c\u3042\u308a\u307e\u305b\u3093\u3002',
  'import.failed': '\u30a4\u30f3\u30dd\u30fc\u30c8\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002',

  // TierListControls
  'controls.titlePlaceholder': '\u30bf\u30a4\u30c8\u30eb\uff08\u4efb\u610f\uff09',
  'controls.vnCount': '{count} 作品',
  'controls.vnCountPlural': '{count} 作品',
  'controls.scores': '\u30b9\u30b3\u30a2\u3092\u8868\u793a',
  'controls.nsfw': 'NSFW\u3092\u8868\u793a',
  'controls.titles': '\u30bf\u30a4\u30c8\u30eb\u3092\u8868\u793a',
  'controls.language': '\u8a00\u8a9e',
  'controls.titleHeight': '\u30bf\u30a4\u30c8\u30eb\u306e\u9ad8\u3055',
  'controls.displaySettings': '\u8a2d\u5b9a',
  'controls.directAdd': '最後のティアに直接追加',
  'controls.copy': '\u30b3\u30d4\u30fc',
  'controls.export': '\u30a8\u30af\u30b9\u30dd\u30fc\u30c8',
  'controls.exportScale': 'エクスポート解像度 (1xまたは2x)',
  'controls.charCount': '{count} キャラ',
  'controls.charCountPlural': '{count} キャラ',
  'controls.shareText': '私のエロゲティアリスト',
  'controls.charShareText': '私のキャラティアリスト',
  'controls.shareHashtags': '#VNTierList #VNClub',
  'controls.charShareHashtags': '#VNTierList #VNClub',
  'controls.linkCopied': 'リンクをコピーしました！',
  'controls.rateLimited': 'リクエストが多すぎます。少々お待ちください',
  'controls.createFailed': 'リンクの作成に失敗しました',

  // TierListBoard — hints
  'hint.text': '\u30c6\u30a3\u30a2\u30e9\u30d9\u30eb\u3092\u30af\u30ea\u30c3\u30af\u3057\u3066\u7de8\u96c6\u3002エロゲ\u30ab\u30d0\u30fc\u3092\u30c6\u30a3\u30a2\u9593\u3067\u30c9\u30e9\u30c3\u30b0\u3002\u81ea\u52d5\u4fdd\u5b58\u3002',
  'hint.textChars': 'ティアラベルをクリックして編集。キャラ画像をティア間でドラッグ。自動保存。',
  'hint.try3x3': '3x3\u30e1\u30fc\u30ab\u30fc\u3092\u8a66\u3059',

  // TierRow
  'tier.dragHere': 'エロゲ\u3092\u3053\u3053\u306b\u30c9\u30e9\u30c3\u30b0',
  'tier.dragHereChars': 'キャラをここにドラッグ',
  'tier.addToTier': '{tier}に追加',

  // TierRowFillModal
  'tierFill.searchVNs': '{tier}にエロゲを追加...',
  'tierFill.searchChars': '{tier}にキャラを追加...',
  'tierFill.vnsPlaceholder': 'エロゲを検索...',
  'tierFill.charsPlaceholder': 'キャラを検索...',

  // TierEditPopover
  'tierEdit.editTier': 'ティアを編集',
  'tierEdit.label': 'ラベル',
  'tierEdit.color': 'カラー',
  'tierEdit.deleteTier': 'ティアを削除',
  'tierEdit.clearRow': '画像をクリア',
  'tierEdit.moveUp': '行を上に移動',
  'tierEdit.moveDown': '行を下に移動',
  'tierEdit.addAbove': '上に行を追加',
  'tierEdit.addBelow': '下に行を追加',

  // TierItem
  'tierItem.edit': '\u7de8\u96c6',
  'tierItem.remove': '\u524a\u9664',

  // エロゲEditModal
  'editModal.header': '\u7de8\u96c6 \u2014 {title}',
  'editModal.headerPrefix': '\u7de8\u96c6 \u2014 ',
  'editModal.viewOnSite': 'VN Club\u3067\u898b\u308b',
  'editModal.viewOnVndb': 'VNDB\u3067\u898b\u308b',
  'editModal.resetTitle': '\u81ea\u52d5\u30bf\u30a4\u30c8\u30eb\u306b\u623b\u3059',
  'editModal.scorePlaceholder': '\u30b9\u30b3\u30a2 (10\u2013100)',
  'editModal.clearScore': '\u30b9\u30b3\u30a2\u3092\u30af\u30ea\u30a2',
  'editModal.cancel': '\u30ad\u30e3\u30f3\u30bb\u30eb',
  'editModal.save': '\u4fdd\u5b58',

  // エロゲSearchAdd
  'search.capacityPlaceholder': '\u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u304c\u5b9a\u54e1\u306b\u9054\u3057\u307e\u3057\u305f\uff08500 作品\uff09',
  'search.charsCapacityPlaceholder': 'ティアリストが定員に達しました（500 キャラ）',
  'search.placeholder': '\u30bf\u30a4\u30c8\u30eb\u307e\u305f\u306fVNDB ID\u3067\u691c\u7d22 (\u4f8b: v17)...',
  'search.charsPlaceholder': 'キャラ名で検索...',
  'search.added': '\u8ffd\u52a0\u6e08\u307f',
  'search.noResults': '結果が見つかりませんでした',
  'search.error': '検索に失敗しました。もう一度お試しください。',

  // Storage
  'storage.warning': '変更を保存できませんでした。ブラウザのストレージがいっぱいです。データを失わないよう、エクスポートまたは共有してください。',

  // Pool
  'pool.label': '未分類',
  'pool.pin': 'プールを固定',
  'pool.unpin': 'プールの固定を解除',
  'pool.emptyHint': 'エロゲを検索して追加',
  'pool.emptyHintChars': 'キャラを検索して追加',
  'import.toPool': 'プールに追加',
  'import.autoSort': 'ティアに自動振り分け',

  // How it works
  'howItWorks.title': '\u4f7f\u3044\u65b9',
  'howItWorks.adding.title': '\u30a2\u30a4\u30c6\u30e0\u306e\u8ffd\u52a0',
  'howItWorks.adding.body': '\u691c\u7d22\u30d0\u30fc\u3067\u30a8\u30ed\u30b2\u3084\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u3092\u540d\u524d\u3084VNDB ID\uff08\u4f8b\uff1a\u300cv17\u300d\u3084\u300c17\u300d\uff09\u3067\u691c\u7d22\u3002\u30af\u30ea\u30c3\u30af\u3059\u308b\u3068\u672a\u5206\u985e\u30d7\u30fc\u30eb\u306b\u8ffd\u52a0\u3055\u308c\u307e\u3059\uff08\u6b6f\u8eca\u30a2\u30a4\u30b3\u30f3\u306e\u300c\u6700\u5f8c\u306e\u30c6\u30a3\u30a2\u306b\u76f4\u63a5\u8ffd\u52a0\u300d\u3092\u6709\u52b9\u306b\u3059\u308b\u3068\u30d7\u30fc\u30eb\u3092\u30b9\u30ad\u30c3\u30d7\u53ef\u80fd\uff09\u3002\u30a8\u30ed\u30b2/\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u30e2\u30fc\u30c9\u306f\u30c8\u30b0\u30eb\u30dc\u30bf\u30f3\u3067\u5207\u308a\u66ff\u3048\u3002VNDB\u306e\u30e6\u30fc\u30b6\u30fc\u540d\u307e\u305f\u306fID\u3092\u5165\u529b\u3059\u308b\u3068\u3001\u8a55\u4fa1\u6e08\u307f\u4f5c\u54c1\u304c\u30b9\u30b3\u30a2\u306b\u5fdc\u3058\u3066\u81ea\u52d5\u7684\u306b\u30c6\u30a3\u30a2\u306b\u632f\u308a\u5206\u3051\u3089\u308c\u307e\u3059\u3002\u6700\u5927500\u30a2\u30a4\u30c6\u30e0\u307e\u3067\u5bfe\u5fdc\u3002',
  'howItWorks.organizing.title': '\u30c6\u30a3\u30a2\u306e\u6574\u7406',
  'howItWorks.organizing.body': 'アイテムをティアにドラッグして配置、特定のアイテムの上にドロップするとその前に挿入、空白部分にドロップすると末尾に配置されます。ティアラベルをクリックすると名前の変更（最大40文字）、色の変更、削除、上下へのティア追加ができます。4つのプリセット（S\u2013F、1\u20135、1\u201310、10\u2013100）があり、切り替えるとアイテムが自動的に再配置されます。',
  'howItWorks.editing.title': '\u30b9\u30b3\u30a2\u3068\u30bf\u30a4\u30c8\u30eb\u306e\u7de8\u96c6',
  'howItWorks.editing.body': '\u30a2\u30a4\u30c6\u30e0\u306b\u30de\u30a6\u30b9\u3092\u5408\u308f\u305b\u3066\u925b\u7b46\u30a2\u30a4\u30b3\u30f3\u3092\u30af\u30ea\u30c3\u30af\u3059\u308b\u3068\u7de8\u96c6\u30e2\u30fc\u30c0\u30eb\u304c\u958b\u304d\u307e\u3059\u3002\u30ab\u30b9\u30bf\u30e0\u30bf\u30a4\u30c8\u30eb\u3067\u30c7\u30d5\u30a9\u30eb\u30c8\u540d\u3092\u4e0a\u66f8\u304d\u3057\u305f\u308a\u3001\u30b9\u30b3\u30a2\uff0810\u2013100\uff09\u3092\u8abf\u6574\u3067\u304d\u307e\u3059\u3002\u6b6f\u8eca\u30a2\u30a4\u30b3\u30f3\u3067\u30b9\u30b3\u30a2\u30d0\u30c3\u30b8\u3084\u30bf\u30a4\u30c8\u30eb\u30aa\u30fc\u30d0\u30fc\u30ec\u30a4\u306e\u8868\u793a\u3092\u5207\u308a\u66ff\u3048\u53ef\u80fd\u3002EN/JP\u30c8\u30b0\u30eb\u3067\u82f1\u8a9e/\u30ed\u30fc\u30de\u5b57\u3068\u65e5\u672c\u8a9e\u30bf\u30a4\u30c8\u30eb\u3092\u5207\u308a\u66ff\u3048\u3089\u308c\u307e\u3059\u3002',
  'howItWorks.display.title': '\u8868\u793a\u30e2\u30fc\u30c9',
  'howItWorks.display.body': '\u30c4\u30fc\u30eb\u30d0\u30fc\u306e\u30dc\u30bf\u30f3\u3067\u30ab\u30d0\u30fc\u753b\u50cf\u30e2\u30fc\u30c9\u3068\u30bf\u30a4\u30c8\u30eb\u306e\u307f\u306e\u30c6\u30ad\u30b9\u30c8\u30e2\u30fc\u30c9\u3092\u5207\u308a\u66ff\u3048\u3089\u308c\u307e\u3059\u3002\u30ab\u30d0\u30fc\u30e2\u30fc\u30c9\u3067\u306f\u5c0f\u30fb\u4e2d\u30fb\u5927\u306e\u30b5\u30e0\u30cd\u30a4\u30eb\u30b5\u30a4\u30ba\u3092\u9078\u629e\u3067\u304d\u3001\u30bf\u30a4\u30c8\u30eb\u3084\u30b9\u30b3\u30a2\u306e\u30aa\u30fc\u30d0\u30fc\u30ec\u30a4\u3082\u8868\u793a\u53ef\u80fd\u3002\u30c6\u30ad\u30b9\u30c8\u30e2\u30fc\u30c9\u306f\u30b3\u30f3\u30d1\u30af\u30c8\u306a\u30e9\u30d9\u30eb\u8868\u793a\u3067\u3001\u591a\u304f\u306e\u30a2\u30a4\u30c6\u30e0\u3092\u5bc6\u5ea6\u9ad8\u304f\u4e26\u3079\u305f\u3044\u3068\u304d\u306b\u4fbf\u5229\u3067\u3059\u3002',
  'howItWorks.exporting.title': '\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3068\u5171\u6709',
  'howItWorks.exporting.body': 'JPG\u3001PNG\u3001WebP\u3067\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3001\u30af\u30ea\u30c3\u30d7\u30dc\u30fc\u30c9\u306b\u30b3\u30d4\u30fc\u3001\u307e\u305f\u306fTwitter\u3001Reddit\u3001\u30c7\u30d0\u30a4\u30b9\u306e\u5171\u6709\u30e1\u30cb\u30e5\u30fc\u3067\u76f4\u63a5\u5171\u6709\u3067\u304d\u307e\u3059\u3002\u5171\u6709\u30ea\u30f3\u30af\u3092\u751f\u6210\u3059\u308b\u3068\u3001\u958b\u3044\u305f\u4eba\u304c\u30b3\u30d4\u30fc\u3092\u4e26\u3079\u66ff\u3048\u3067\u304d\u308b\u306e\u3067\u3001\u53cb\u4eba\u306b\u30c6\u30f3\u30d7\u30ec\u30fc\u30c8\u3068\u3057\u3066\u9001\u308a\u3001\u540c\u3058\u4f5c\u54c1\u30bb\u30c3\u30c8\u3067\u81ea\u5206\u306e\u30e9\u30f3\u30ad\u30f3\u30b0\u3092\u4f5c\u3063\u3066\u3082\u3089\u3046\u4f7f\u3044\u65b9\u304c\u3067\u304d\u307e\u3059\u3002\u30c6\u30a3\u30a2\u4e0a\u306e\u30c6\u30ad\u30b9\u30c8\u30d5\u30a3\u30fc\u30eb\u30c9\u3067\u30bf\u30a4\u30c8\u30eb\u3092\u8a2d\u5b9a\u3059\u308b\u3068\u3001\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u753b\u50cf\u306e\u30d8\u30c3\u30c0\u30fc\u306b\u8868\u793a\u3055\u308c\u307e\u3059\u3002NSFW\u30ab\u30d0\u30fc\u306f\u30c7\u30d5\u30a9\u30eb\u30c8\u3067\u30d6\u30e9\u30fc\u3055\u308c\u307e\u3059\u3002\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3067\u7121\u4fee\u6b63\u306b\u3059\u308b\u306b\u306f\u3001\u500b\u5225\u306e\u30ab\u30d0\u30fc\u3092\u30af\u30ea\u30c3\u30af\u3057\u3066\u8868\u793a\u3059\u308b\u304b\u3001\u6b6f\u8eca\u30a2\u30a4\u30b3\u30f3\u304b\u3089\u300cNSFW\u3092\u8868\u793a\u300d\u3092\u6709\u52b9\u306b\u3057\u3066\u304f\u3060\u3055\u3044\uff08\u30b5\u30a4\u30c8\u5168\u4f53\u306e\u300cNSFW\u3092\u7121\u4fee\u6b63\u3067\u8868\u793a\u300d\u3068\u540c\u3058\u8a2d\u5b9a\u3067\u3059\uff09\u3002\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u753b\u50cf\u306f1200px\u56fa\u5b9a\u5e45\u3067\u4e00\u8cab\u3057\u305f\u54c1\u8cea\u3092\u4fdd\u3061\u3001\u30b5\u30e0\u30cd\u30a4\u30eb\u30b5\u30a4\u30ba\u3001\u8a00\u8a9e\u3001\u30c6\u30fc\u30de\u306a\u3069\u73fe\u5728\u306e\u8868\u793a\u8a2d\u5b9a\u3092\u53cd\u6620\u3057\u307e\u3059\u3002',
  'howItWorks.autoSave.title': '\u81ea\u52d5\u4fdd\u5b58',
  'howItWorks.autoSave.body': '\u30c6\u30a3\u30a2\u306e\u30ec\u30a4\u30a2\u30a6\u30c8\u3001\u30a2\u30a4\u30c6\u30e0\u306e\u914d\u7f6e\u3001\u30ab\u30b9\u30bf\u30e0\u30bf\u30a4\u30c8\u30eb\u3001\u30b9\u30b3\u30a2\u3001\u8868\u793a\u8a2d\u5b9a\u306a\u3069\u3001\u3059\u3079\u3066\u304c\u30d6\u30e9\u30a6\u30b6\u306b\u81ea\u52d5\u4fdd\u5b58\u3055\u308c\u307e\u3059\u3002VNDB\u304b\u3089\u30a4\u30f3\u30dd\u30fc\u30c8\u3057\u305f\u5834\u5408\u3001URL\u304c\u66f4\u65b0\u3055\u308c\u308b\u306e\u3067\u30d6\u30c3\u30af\u30de\u30fc\u30af\u3084\u5171\u6709\u306b\u4fbf\u5229\u3067\u3059\u3002',
};

export const tierListStrings = { en, ja };
