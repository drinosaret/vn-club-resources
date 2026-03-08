const en = {
  // TierListContent
  'page.title': 'Visual Novel Tier List Maker',
  'page.subtitle': 'Import your VNDB ratings or search for visual novels. Drag and drop to rank into tiers, then export as a shareable image.',

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
  'controls.displaySettings': 'Display settings',
  'controls.directAdd': 'Add directly to last tier',
  'controls.copy': 'Copy',
  'controls.export': 'Export',
  'controls.charCount': '{count} Character',
  'controls.charCountPlural': '{count} Characters',
  'controls.shareText': 'My VN tier list',
  'controls.charShareText': 'My character tier list',
  'controls.shareHashtags': '#VNTierList #VNClub',
  'controls.charShareHashtags': '#VNTierList #VNClub',

  // TierListBoard — hints
  'hint.text': 'Click tier labels to edit. Drag VN covers between tiers. Auto-saved.',
  'hint.textChars': 'Click tier labels to edit. Drag character images between tiers. Auto-saved.',
  'hint.try3x3': 'Try the 3x3 Maker',

  // TierRow
  'tier.dragHere': 'Drag VNs here',
  'tier.dragHereChars': 'Drag characters here',

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
  'howItWorks.adding.title': 'Adding visual novels',
  'howItWorks.adding.body': 'Use the search bar at the top to find VNs by title or VNDB ID (e.g. \u201cv17\u201d or \u201c17\u201d). Results show the cover, release year, and VNDB rating. Click a result to add it to the bottom tier. You can also import your scored list from VNDB by entering your username or user ID, and your rated VNs will be automatically distributed across tiers based on their scores. The tier list supports up to 500 VNs.',
  'howItWorks.organizing.title': 'Organizing your tiers',
  'howItWorks.organizing.body': 'Pick up a VN and drop it on another tier to move it there, or drop it on a specific VN to insert before it. Dropping on empty space in a tier places it at the end. Click a tier label to rename it (up to 10 characters), change its color from 11 options, or delete it entirely. Add new tiers with the \u201cAdd Tier\u201d button. Four presets are available (S\u2013F, 1\u20135, 1\u201310, and 10\u2013100), and your VNs will redistribute automatically when you switch between them.',
  'howItWorks.editing.title': 'Editing scores and titles',
  'howItWorks.editing.body': 'Hover over any VN and click the pencil icon to open the edit modal. From there you can set a custom title that overrides the default, or adjust the vote score (10\u2013100). Scores and titles can be displayed as overlays on cover images using the checkboxes in the controls bar. The EN/JP toggle switches between English/romaji and Japanese titles across the entire list.',
  'howItWorks.display.title': 'Display modes',
  'howItWorks.display.body': 'Toggle between cover image mode and title-only text mode using the buttons next to the preset selector. Cover mode shows VN artwork with optional title and score overlays. In cover mode, choose between small, medium, and large thumbnail sizes. Title mode shows compact text labels, which is useful when you have a lot of VNs and want a denser view.',
  'howItWorks.exporting.title': 'Exporting and sharing',
  'howItWorks.exporting.body': 'When you\u2019re happy with your tier list, use the export controls to download it as a PNG image, copy it to your clipboard, or share it directly. You can set a title for your tier list using the text field in the controls bar, and it will appear as a header in the exported image. Use the NSFW checkbox to reveal blurred covers for the export. The exported image is rendered at a fixed 1200px width for consistent quality and respects your current display settings, including language preference. If you imported from VNDB, your tier list URL updates automatically so you can share the link with others and they\u2019ll see the same preset and import.',
  'howItWorks.autoSave.title': 'Auto-save',
  'howItWorks.autoSave.body': 'Everything is saved to your browser automatically as you work, including tier layouts, VN assignments, custom titles, scores, and your imported username. Come back anytime and pick up where you left off.',
} as const;

type TierListKeys = keyof typeof en;

const ja: Record<TierListKeys, string> = {
  // TierListContent
  'page.title': '\u30a8\u30ed\u30b2 \u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u30e1\u30fc\u30ab\u30fc',
  'page.subtitle': 'VNDB\u306e\u8a55\u4fa1\u3092\u30a4\u30f3\u30dd\u30fc\u30c8\u3059\u308b\u304b\u3001\u30a8\u30ed\u30b2\u3092\u691c\u7d22\u3002\u30c9\u30e9\u30c3\u30b0\uff06\u30c9\u30ed\u30c3\u30d7\u3067\u30c6\u30a3\u30a2\u306b\u632f\u308a\u5206\u3051\u3001\u5171\u6709\u53ef\u80fd\u306a\u753b\u50cf\u3068\u3057\u3066\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3002',

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
  'controls.displaySettings': '\u8868\u793a\u8a2d\u5b9a',
  'controls.directAdd': '最後のティアに直接追加',
  'controls.copy': '\u30b3\u30d4\u30fc',
  'controls.export': '\u30a8\u30af\u30b9\u30dd\u30fc\u30c8',
  'controls.charCount': '{count} キャラ',
  'controls.charCountPlural': '{count} キャラ',
  'controls.shareText': '私のエロゲティアリスト',
  'controls.charShareText': '私のキャラティアリスト',
  'controls.shareHashtags': '#エロゲティアリスト #VNClub',
  'controls.charShareHashtags': '#エロゲティアリスト #VNClub',

  // TierListBoard — hints
  'hint.text': '\u30c6\u30a3\u30a2\u30e9\u30d9\u30eb\u3092\u30af\u30ea\u30c3\u30af\u3057\u3066\u7de8\u96c6\u3002エロゲ\u30ab\u30d0\u30fc\u3092\u30c6\u30a3\u30a2\u9593\u3067\u30c9\u30e9\u30c3\u30b0\u3002\u81ea\u52d5\u4fdd\u5b58\u3002',
  'hint.textChars': 'ティアラベルをクリックして編集。キャラ画像をティア間でドラッグ。自動保存。',
  'hint.try3x3': '3x3\u30e1\u30fc\u30ab\u30fc\u3092\u8a66\u3059',

  // TierRow
  'tier.dragHere': 'エロゲ\u3092\u3053\u3053\u306b\u30c9\u30e9\u30c3\u30b0',
  'tier.dragHereChars': 'キャラをここにドラッグ',

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
  'search.error': '検索できません。もう一度お試しください。',

  // Storage
  'storage.warning': '変更を保存できませんでした。ブラウザのストレージがいっぱいです。データを失わないよう、エクスポートまたは共有してください。',

  // Pool
  'pool.label': '未ランク',
  'pool.pin': 'プールを固定',
  'pool.unpin': 'プールの固定を解除',
  'pool.emptyHint': 'エロゲを検索して追加',
  'pool.emptyHintChars': 'キャラを検索して追加',
  'import.toPool': 'プールに追加',
  'import.autoSort': 'ティアに自動振り分け',

  // How it works
  'howItWorks.title': '\u4f7f\u3044\u65b9',
  'howItWorks.adding.title': '\u30a8\u30ed\u30b2\u306e\u8ffd\u52a0',
  'howItWorks.adding.body': '\u4e0a\u90e8\u306e\u691c\u7d22\u30d0\u30fc\u3067\u30bf\u30a4\u30c8\u30eb\u3084VNDB ID\uff08\u4f8b\uff1a\u300cv17\u300d\u3084\u300c17\u300d\uff09\u3067エロゲ\u3092\u691c\u7d22\u3067\u304d\u307e\u3059\u3002\u691c\u7d22\u7d50\u679c\u306b\u306f\u30ab\u30d0\u30fc\u3001\u767a\u58f2\u5e74\u3001VNDB\u8a55\u4fa1\u304c\u8868\u793a\u3055\u308c\u307e\u3059\u3002\u7d50\u679c\u3092\u30af\u30ea\u30c3\u30af\u3059\u308b\u3068\u6700\u4e0b\u90e8\u306e\u30c6\u30a3\u30a2\u306b\u8ffd\u52a0\u3055\u308c\u307e\u3059\u3002VNDB\u306e\u30e6\u30fc\u30b6\u30fc\u540d\u307e\u305f\u306fID\u3092\u5165\u529b\u3059\u308b\u3068\u3001\u8a55\u4fa1\u6e08\u307f\u4f5c\u54c1\u304c\u30b9\u30b3\u30a2\u306b\u5fdc\u3058\u3066\u81ea\u52d5\u7684\u306b\u30c6\u30a3\u30a2\u306b\u632f\u308a\u5206\u3051\u3089\u308c\u307e\u3059\u3002\u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u306f\u6700\u5927500\u4f5c\u54c1\u307e\u3067\u5bfe\u5fdc\u3002',
  'howItWorks.organizing.title': '\u30c6\u30a3\u30a2\u306e\u6574\u7406',
  'howItWorks.organizing.body': '\u30a8\u30ed\u30b2\u3092\u3064\u304b\u3093\u3067\u5225\u306e\u30c6\u30a3\u30a2\u306b\u30c9\u30ed\u30c3\u30d7\u3059\u308b\u3068\u79fb\u52d5\u3067\u304d\u307e\u3059\u3002\u7279\u5b9a\u306e\u30a8\u30ed\u30b2\u306e\u4e0a\u306b\u30c9\u30ed\u30c3\u30d7\u3059\u308b\u3068\u305d\u306e\u524d\u306b\u633f\u5165\u3055\u308c\u3001\u30c6\u30a3\u30a2\u306e\u7a7a\u767d\u90e8\u5206\u306b\u30c9\u30ed\u30c3\u30d7\u3059\u308b\u3068\u672b\u5c3e\u306b\u914d\u7f6e\u3055\u308c\u307e\u3059\u3002\u30c6\u30a3\u30a2\u30e9\u30d9\u30eb\u3092\u30af\u30ea\u30c3\u30af\u3059\u308b\u3068\u3001\u540d\u524d\u306e\u5909\u66f4\uff08\u6700\u592710\u6587\u5b57\uff09\u300111\u8272\u304b\u3089\u306e\u8272\u5909\u66f4\u3001\u307e\u305f\u306f\u524a\u9664\u304c\u3067\u304d\u307e\u3059\u3002\u300c\u30c6\u30a3\u30a2\u8ffd\u52a0\u300d\u30dc\u30bf\u30f3\u3067\u65b0\u3057\u3044\u30c6\u30a3\u30a2\u3092\u8ffd\u52a0\u30024\u3064\u306e\u30d7\u30ea\u30bb\u30c3\u30c8\uff08S\u2013F\u30011\u20135\u30011\u201310\u300110\u2013100\uff09\u304c\u3042\u308a\u3001\u5207\u308a\u66ff\u3048\u308b\u3068\u30a8\u30ed\u30b2\u304c\u81ea\u52d5\u7684\u306b\u518d\u914d\u7f6e\u3055\u308c\u307e\u3059\u3002',
  'howItWorks.editing.title': '\u30b9\u30b3\u30a2\u3068\u30bf\u30a4\u30c8\u30eb\u306e\u7de8\u96c6',
  'howItWorks.editing.body': 'エロゲ\u306b\u30de\u30a6\u30b9\u3092\u5408\u308f\u305b\u3066\u925b\u7b46\u30a2\u30a4\u30b3\u30f3\u3092\u30af\u30ea\u30c3\u30af\u3059\u308b\u3068\u3001\u7de8\u96c6\u30e2\u30fc\u30c0\u30eb\u304c\u958b\u304d\u307e\u3059\u3002\u30ab\u30b9\u30bf\u30e0\u30bf\u30a4\u30c8\u30eb\u3067\u30c7\u30d5\u30a9\u30eb\u30c8\u540d\u3092\u4e0a\u66f8\u304d\u3057\u305f\u308a\u3001\u30b9\u30b3\u30a2\uff0810\u2013100\uff09\u3092\u8abf\u6574\u3067\u304d\u307e\u3059\u3002\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb\u30d0\u30fc\u306e\u30c1\u30a7\u30c3\u30af\u30dc\u30c3\u30af\u30b9\u3067\u30ab\u30d0\u30fc\u753b\u50cf\u306b\u30b9\u30b3\u30a2\u3084\u30bf\u30a4\u30c8\u30eb\u3092\u30aa\u30fc\u30d0\u30fc\u30ec\u30a4\u8868\u793a\u3067\u304d\u307e\u3059\u3002EN/JP\u30c8\u30b0\u30eb\u3067\u82f1\u8a9e/\u30ed\u30fc\u30de\u5b57\u3068\u65e5\u672c\u8a9e\u30bf\u30a4\u30c8\u30eb\u3092\u5207\u308a\u66ff\u3048\u3089\u308c\u307e\u3059\u3002',
  'howItWorks.display.title': '\u8868\u793a\u30e2\u30fc\u30c9',
  'howItWorks.display.body': '\u30d7\u30ea\u30bb\u30c3\u30c8\u30bb\u30ec\u30af\u30bf\u30fc\u306e\u6a2a\u306e\u30dc\u30bf\u30f3\u3067\u30ab\u30d0\u30fc\u753b\u50cf\u30e2\u30fc\u30c9\u3068\u30bf\u30a4\u30c8\u30eb\u306e\u307f\u306e\u30c6\u30ad\u30b9\u30c8\u30e2\u30fc\u30c9\u3092\u5207\u308a\u66ff\u3048\u3089\u308c\u307e\u3059\u3002\u30ab\u30d0\u30fc\u30e2\u30fc\u30c9\u3067\u306fエロゲ\u306e\u30a2\u30fc\u30c8\u30ef\u30fc\u30af\u304c\u8868\u793a\u3055\u308c\u3001\u30bf\u30a4\u30c8\u30eb\u3084\u30b9\u30b3\u30a2\u306e\u30aa\u30fc\u30d0\u30fc\u30ec\u30a4\u3082\u30aa\u30d7\u30b7\u30e7\u30f3\u3067\u8868\u793a\u53ef\u80fd\u3002\u30ab\u30d0\u30fc\u30e2\u30fc\u30c9\u3067\u306f\u5c0f\u30fb\u4e2d\u30fb\u5927\u306e\u30b5\u30e0\u30cd\u30a4\u30eb\u30b5\u30a4\u30ba\u3092\u9078\u629e\u3067\u304d\u307e\u3059\u3002\u30c6\u30ad\u30b9\u30c8\u30e2\u30fc\u30c9\u3067\u306f\u30b3\u30f3\u30d1\u30af\u30c8\u306a\u30c6\u30ad\u30b9\u30c8\u30e9\u30d9\u30eb\u304c\u8868\u793a\u3055\u308c\u3001\u591a\u304f\u306eエロゲ\u3092\u5bc6\u5ea6\u9ad8\u304f\u4e26\u3079\u305f\u3044\u3068\u304d\u306b\u4fbf\u5229\u3067\u3059\u3002',
  'howItWorks.exporting.title': '\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3068\u5171\u6709',
  'howItWorks.exporting.body': '\u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u304c\u5b8c\u6210\u3057\u305f\u3089\u3001\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb\u3067PNG\u753b\u50cf\u3068\u3057\u3066\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9\u3001\u30af\u30ea\u30c3\u30d7\u30dc\u30fc\u30c9\u306b\u30b3\u30d4\u30fc\u3001\u307e\u305f\u306f\u76f4\u63a5\u5171\u6709\u3067\u304d\u307e\u3059\u3002\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb\u30d0\u30fc\u306e\u30c6\u30ad\u30b9\u30c8\u30d5\u30a3\u30fc\u30eb\u30c9\u3067\u30bf\u30a4\u30c8\u30eb\u3092\u8a2d\u5b9a\u3059\u308b\u3068\u3001\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u753b\u50cf\u306e\u30d8\u30c3\u30c0\u30fc\u306b\u8868\u793a\u3055\u308c\u307e\u3059\u3002NSFW\u30c1\u30a7\u30c3\u30af\u30dc\u30c3\u30af\u30b9\u3067\u30d6\u30e9\u30fc\u3055\u308c\u305f\u30ab\u30d0\u30fc\u3092\u8868\u793a\u3067\u304d\u307e\u3059\u3002\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u753b\u50cf\u306f1200px\u56fa\u5b9a\u5e45\u3067\u4e00\u8cab\u3057\u305f\u54c1\u8cea\u3092\u4fdd\u3061\u3001\u73fe\u5728\u306e\u8868\u793a\u8a2d\u5b9a\uff08\u8a00\u8a9e\u542b\u3080\uff09\u3092\u53cd\u6620\u3057\u307e\u3059\u3002VNDB\u304b\u3089\u30a4\u30f3\u30dd\u30fc\u30c8\u3057\u305f\u5834\u5408\u3001URL\u304c\u81ea\u52d5\u66f4\u65b0\u3055\u308c\u308b\u306e\u3067\u30ea\u30f3\u30af\u3092\u5171\u6709\u3067\u304d\u307e\u3059\u3002',
  'howItWorks.autoSave.title': '\u81ea\u52d5\u4fdd\u5b58',
  'howItWorks.autoSave.body': '\u30c6\u30a3\u30a2\u306e\u30ec\u30a4\u30a2\u30a6\u30c8\u3001エロゲ\u306e\u914d\u7f6e\u3001\u30ab\u30b9\u30bf\u30e0\u30bf\u30a4\u30c8\u30eb\u3001\u30b9\u30b3\u30a2\u3001\u30a4\u30f3\u30dd\u30fc\u30c8\u3057\u305f\u30e6\u30fc\u30b6\u30fc\u540d\u306a\u3069\u3001\u3059\u3079\u3066\u304c\u30d6\u30e9\u30a6\u30b6\u306b\u81ea\u52d5\u4fdd\u5b58\u3055\u308c\u307e\u3059\u3002\u3044\u3064\u3067\u3082\u4e2d\u65ad\u3057\u305f\u3068\u3053\u308d\u304b\u3089\u518d\u958b\u3067\u304d\u307e\u3059\u3002',
};

export const tierListStrings = { en, ja };
