// Kana data for the quiz feature

export type KanaRow = 'vowel' | 'k' | 's' | 't' | 'n' | 'h' | 'm' | 'y' | 'r' | 'w' | 'g' | 'z' | 'd' | 'b' | 'p';

export interface KanaCharacter {
  kana: string;
  romaji: string;
  alternates?: string[]; // Alternative romanizations (e.g., si for shi)
  type: 'basic' | 'dakuten' | 'handakuten' | 'combo';
  row: KanaRow;
}

export interface QuizSettings {
  hiraganaRows: KanaRow[];
  katakanaRows: KanaRow[];
  includeCombo: boolean;
}

// All basic rows
export const basicRows: KanaRow[] = ['vowel', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w'];
// Alternative/dakuten rows
export const dakutenRows: KanaRow[] = ['g', 'z', 'd', 'b', 'p'];
// All rows
export const allRows: KanaRow[] = [...basicRows, ...dakutenRows];

// Row display labels
export const rowLabels: Record<KanaRow, string> = {
  vowel: 'a · i · u · e · o',
  k: 'ka · ki · ku · ke · ko',
  s: 'sa · shi · su · se · so',
  t: 'ta · chi · tsu · te · to',
  n: 'na · ni · nu · ne · no',
  h: 'ha · hi · fu · he · ho',
  m: 'ma · mi · mu · me · mo',
  y: 'ya · yu · yo',
  r: 'ra · ri · ru · re · ro',
  w: 'wa · wo · n',
  g: 'ga · gi · gu · ge · go',
  z: 'za · ji · zu · ze · zo',
  d: 'da · di · du · de · do',
  b: 'ba · bi · bu · be · bo',
  p: 'pa · pi · pu · pe · po',
};

// Basic Hiragana (46 characters)
export const hiraganaBasic: KanaCharacter[] = [
  // Vowels
  { kana: 'あ', romaji: 'a', type: 'basic', row: 'vowel' },
  { kana: 'い', romaji: 'i', type: 'basic', row: 'vowel' },
  { kana: 'う', romaji: 'u', type: 'basic', row: 'vowel' },
  { kana: 'え', romaji: 'e', type: 'basic', row: 'vowel' },
  { kana: 'お', romaji: 'o', type: 'basic', row: 'vowel' },
  // K-row
  { kana: 'か', romaji: 'ka', type: 'basic', row: 'k' },
  { kana: 'き', romaji: 'ki', type: 'basic', row: 'k' },
  { kana: 'く', romaji: 'ku', type: 'basic', row: 'k' },
  { kana: 'け', romaji: 'ke', type: 'basic', row: 'k' },
  { kana: 'こ', romaji: 'ko', type: 'basic', row: 'k' },
  // S-row
  { kana: 'さ', romaji: 'sa', type: 'basic', row: 's' },
  { kana: 'し', romaji: 'shi', alternates: ['si'], type: 'basic', row: 's' },
  { kana: 'す', romaji: 'su', type: 'basic', row: 's' },
  { kana: 'せ', romaji: 'se', type: 'basic', row: 's' },
  { kana: 'そ', romaji: 'so', type: 'basic', row: 's' },
  // T-row
  { kana: 'た', romaji: 'ta', type: 'basic', row: 't' },
  { kana: 'ち', romaji: 'chi', alternates: ['ti'], type: 'basic', row: 't' },
  { kana: 'つ', romaji: 'tsu', alternates: ['tu'], type: 'basic', row: 't' },
  { kana: 'て', romaji: 'te', type: 'basic', row: 't' },
  { kana: 'と', romaji: 'to', type: 'basic', row: 't' },
  // N-row
  { kana: 'な', romaji: 'na', type: 'basic', row: 'n' },
  { kana: 'に', romaji: 'ni', type: 'basic', row: 'n' },
  { kana: 'ぬ', romaji: 'nu', type: 'basic', row: 'n' },
  { kana: 'ね', romaji: 'ne', type: 'basic', row: 'n' },
  { kana: 'の', romaji: 'no', type: 'basic', row: 'n' },
  // H-row
  { kana: 'は', romaji: 'ha', type: 'basic', row: 'h' },
  { kana: 'ひ', romaji: 'hi', type: 'basic', row: 'h' },
  { kana: 'ふ', romaji: 'fu', alternates: ['hu'], type: 'basic', row: 'h' },
  { kana: 'へ', romaji: 'he', type: 'basic', row: 'h' },
  { kana: 'ほ', romaji: 'ho', type: 'basic', row: 'h' },
  // M-row
  { kana: 'ま', romaji: 'ma', type: 'basic', row: 'm' },
  { kana: 'み', romaji: 'mi', type: 'basic', row: 'm' },
  { kana: 'む', romaji: 'mu', type: 'basic', row: 'm' },
  { kana: 'め', romaji: 'me', type: 'basic', row: 'm' },
  { kana: 'も', romaji: 'mo', type: 'basic', row: 'm' },
  // Y-row
  { kana: 'や', romaji: 'ya', type: 'basic', row: 'y' },
  { kana: 'ゆ', romaji: 'yu', type: 'basic', row: 'y' },
  { kana: 'よ', romaji: 'yo', type: 'basic', row: 'y' },
  // R-row
  { kana: 'ら', romaji: 'ra', type: 'basic', row: 'r' },
  { kana: 'り', romaji: 'ri', type: 'basic', row: 'r' },
  { kana: 'る', romaji: 'ru', type: 'basic', row: 'r' },
  { kana: 'れ', romaji: 're', type: 'basic', row: 'r' },
  { kana: 'ろ', romaji: 'ro', type: 'basic', row: 'r' },
  // W-row
  { kana: 'わ', romaji: 'wa', type: 'basic', row: 'w' },
  { kana: 'を', romaji: 'wo', alternates: ['o'], type: 'basic', row: 'w' },
  // N
  { kana: 'ん', romaji: 'n', type: 'basic', row: 'w' },
];

// Dakuten Hiragana (voiced consonants)
export const hiraganaDakuten: KanaCharacter[] = [
  // G-row
  { kana: 'が', romaji: 'ga', type: 'dakuten', row: 'g' },
  { kana: 'ぎ', romaji: 'gi', type: 'dakuten', row: 'g' },
  { kana: 'ぐ', romaji: 'gu', type: 'dakuten', row: 'g' },
  { kana: 'げ', romaji: 'ge', type: 'dakuten', row: 'g' },
  { kana: 'ご', romaji: 'go', type: 'dakuten', row: 'g' },
  // Z-row
  { kana: 'ざ', romaji: 'za', type: 'dakuten', row: 'z' },
  { kana: 'じ', romaji: 'ji', alternates: ['zi'], type: 'dakuten', row: 'z' },
  { kana: 'ず', romaji: 'zu', type: 'dakuten', row: 'z' },
  { kana: 'ぜ', romaji: 'ze', type: 'dakuten', row: 'z' },
  { kana: 'ぞ', romaji: 'zo', type: 'dakuten', row: 'z' },
  // D-row
  { kana: 'だ', romaji: 'da', type: 'dakuten', row: 'd' },
  { kana: 'ぢ', romaji: 'ji', alternates: ['di', 'dji'], type: 'dakuten', row: 'd' },
  { kana: 'づ', romaji: 'zu', alternates: ['du', 'dzu'], type: 'dakuten', row: 'd' },
  { kana: 'で', romaji: 'de', type: 'dakuten', row: 'd' },
  { kana: 'ど', romaji: 'do', type: 'dakuten', row: 'd' },
  // B-row
  { kana: 'ば', romaji: 'ba', type: 'dakuten', row: 'b' },
  { kana: 'び', romaji: 'bi', type: 'dakuten', row: 'b' },
  { kana: 'ぶ', romaji: 'bu', type: 'dakuten', row: 'b' },
  { kana: 'べ', romaji: 'be', type: 'dakuten', row: 'b' },
  { kana: 'ぼ', romaji: 'bo', type: 'dakuten', row: 'b' },
  // P-row (handakuten)
  { kana: 'ぱ', romaji: 'pa', type: 'handakuten', row: 'p' },
  { kana: 'ぴ', romaji: 'pi', type: 'handakuten', row: 'p' },
  { kana: 'ぷ', romaji: 'pu', type: 'handakuten', row: 'p' },
  { kana: 'ぺ', romaji: 'pe', type: 'handakuten', row: 'p' },
  { kana: 'ぽ', romaji: 'po', type: 'handakuten', row: 'p' },
];

// Combo Hiragana (ya, yu, yo combinations)
export const hiraganaCombo: KanaCharacter[] = [
  // K-combos
  { kana: 'きゃ', romaji: 'kya', type: 'combo', row: 'k' },
  { kana: 'きゅ', romaji: 'kyu', type: 'combo', row: 'k' },
  { kana: 'きょ', romaji: 'kyo', type: 'combo', row: 'k' },
  // S-combos
  { kana: 'しゃ', romaji: 'sha', alternates: ['sya'], type: 'combo', row: 's' },
  { kana: 'しゅ', romaji: 'shu', alternates: ['syu'], type: 'combo', row: 's' },
  { kana: 'しょ', romaji: 'sho', alternates: ['syo'], type: 'combo', row: 's' },
  // T-combos
  { kana: 'ちゃ', romaji: 'cha', alternates: ['tya'], type: 'combo', row: 't' },
  { kana: 'ちゅ', romaji: 'chu', alternates: ['tyu'], type: 'combo', row: 't' },
  { kana: 'ちょ', romaji: 'cho', alternates: ['tyo'], type: 'combo', row: 't' },
  // N-combos
  { kana: 'にゃ', romaji: 'nya', type: 'combo', row: 'n' },
  { kana: 'にゅ', romaji: 'nyu', type: 'combo', row: 'n' },
  { kana: 'にょ', romaji: 'nyo', type: 'combo', row: 'n' },
  // H-combos
  { kana: 'ひゃ', romaji: 'hya', type: 'combo', row: 'h' },
  { kana: 'ひゅ', romaji: 'hyu', type: 'combo', row: 'h' },
  { kana: 'ひょ', romaji: 'hyo', type: 'combo', row: 'h' },
  // M-combos
  { kana: 'みゃ', romaji: 'mya', type: 'combo', row: 'm' },
  { kana: 'みゅ', romaji: 'myu', type: 'combo', row: 'm' },
  { kana: 'みょ', romaji: 'myo', type: 'combo', row: 'm' },
  // R-combos
  { kana: 'りゃ', romaji: 'rya', type: 'combo', row: 'r' },
  { kana: 'りゅ', romaji: 'ryu', type: 'combo', row: 'r' },
  { kana: 'りょ', romaji: 'ryo', type: 'combo', row: 'r' },
  // G-combos
  { kana: 'ぎゃ', romaji: 'gya', type: 'combo', row: 'g' },
  { kana: 'ぎゅ', romaji: 'gyu', type: 'combo', row: 'g' },
  { kana: 'ぎょ', romaji: 'gyo', type: 'combo', row: 'g' },
  // J-combos
  { kana: 'じゃ', romaji: 'ja', alternates: ['zya', 'jya'], type: 'combo', row: 'z' },
  { kana: 'じゅ', romaji: 'ju', alternates: ['zyu', 'jyu'], type: 'combo', row: 'z' },
  { kana: 'じょ', romaji: 'jo', alternates: ['zyo', 'jyo'], type: 'combo', row: 'z' },
  // B-combos
  { kana: 'びゃ', romaji: 'bya', type: 'combo', row: 'b' },
  { kana: 'びゅ', romaji: 'byu', type: 'combo', row: 'b' },
  { kana: 'びょ', romaji: 'byo', type: 'combo', row: 'b' },
  // P-combos
  { kana: 'ぴゃ', romaji: 'pya', type: 'combo', row: 'p' },
  { kana: 'ぴゅ', romaji: 'pyu', type: 'combo', row: 'p' },
  { kana: 'ぴょ', romaji: 'pyo', type: 'combo', row: 'p' },
];

// Basic Katakana (46 characters)
export const katakanaBasic: KanaCharacter[] = [
  // Vowels
  { kana: 'ア', romaji: 'a', type: 'basic', row: 'vowel' },
  { kana: 'イ', romaji: 'i', type: 'basic', row: 'vowel' },
  { kana: 'ウ', romaji: 'u', type: 'basic', row: 'vowel' },
  { kana: 'エ', romaji: 'e', type: 'basic', row: 'vowel' },
  { kana: 'オ', romaji: 'o', type: 'basic', row: 'vowel' },
  // K-row
  { kana: 'カ', romaji: 'ka', type: 'basic', row: 'k' },
  { kana: 'キ', romaji: 'ki', type: 'basic', row: 'k' },
  { kana: 'ク', romaji: 'ku', type: 'basic', row: 'k' },
  { kana: 'ケ', romaji: 'ke', type: 'basic', row: 'k' },
  { kana: 'コ', romaji: 'ko', type: 'basic', row: 'k' },
  // S-row
  { kana: 'サ', romaji: 'sa', type: 'basic', row: 's' },
  { kana: 'シ', romaji: 'shi', alternates: ['si'], type: 'basic', row: 's' },
  { kana: 'ス', romaji: 'su', type: 'basic', row: 's' },
  { kana: 'セ', romaji: 'se', type: 'basic', row: 's' },
  { kana: 'ソ', romaji: 'so', type: 'basic', row: 's' },
  // T-row
  { kana: 'タ', romaji: 'ta', type: 'basic', row: 't' },
  { kana: 'チ', romaji: 'chi', alternates: ['ti'], type: 'basic', row: 't' },
  { kana: 'ツ', romaji: 'tsu', alternates: ['tu'], type: 'basic', row: 't' },
  { kana: 'テ', romaji: 'te', type: 'basic', row: 't' },
  { kana: 'ト', romaji: 'to', type: 'basic', row: 't' },
  // N-row
  { kana: 'ナ', romaji: 'na', type: 'basic', row: 'n' },
  { kana: 'ニ', romaji: 'ni', type: 'basic', row: 'n' },
  { kana: 'ヌ', romaji: 'nu', type: 'basic', row: 'n' },
  { kana: 'ネ', romaji: 'ne', type: 'basic', row: 'n' },
  { kana: 'ノ', romaji: 'no', type: 'basic', row: 'n' },
  // H-row
  { kana: 'ハ', romaji: 'ha', type: 'basic', row: 'h' },
  { kana: 'ヒ', romaji: 'hi', type: 'basic', row: 'h' },
  { kana: 'フ', romaji: 'fu', alternates: ['hu'], type: 'basic', row: 'h' },
  { kana: 'ヘ', romaji: 'he', type: 'basic', row: 'h' },
  { kana: 'ホ', romaji: 'ho', type: 'basic', row: 'h' },
  // M-row
  { kana: 'マ', romaji: 'ma', type: 'basic', row: 'm' },
  { kana: 'ミ', romaji: 'mi', type: 'basic', row: 'm' },
  { kana: 'ム', romaji: 'mu', type: 'basic', row: 'm' },
  { kana: 'メ', romaji: 'me', type: 'basic', row: 'm' },
  { kana: 'モ', romaji: 'mo', type: 'basic', row: 'm' },
  // Y-row
  { kana: 'ヤ', romaji: 'ya', type: 'basic', row: 'y' },
  { kana: 'ユ', romaji: 'yu', type: 'basic', row: 'y' },
  { kana: 'ヨ', romaji: 'yo', type: 'basic', row: 'y' },
  // R-row
  { kana: 'ラ', romaji: 'ra', type: 'basic', row: 'r' },
  { kana: 'リ', romaji: 'ri', type: 'basic', row: 'r' },
  { kana: 'ル', romaji: 'ru', type: 'basic', row: 'r' },
  { kana: 'レ', romaji: 're', type: 'basic', row: 'r' },
  { kana: 'ロ', romaji: 'ro', type: 'basic', row: 'r' },
  // W-row
  { kana: 'ワ', romaji: 'wa', type: 'basic', row: 'w' },
  { kana: 'ヲ', romaji: 'wo', alternates: ['o'], type: 'basic', row: 'w' },
  // N
  { kana: 'ン', romaji: 'n', type: 'basic', row: 'w' },
];

// Dakuten Katakana (voiced consonants)
export const katakanaDakuten: KanaCharacter[] = [
  // G-row
  { kana: 'ガ', romaji: 'ga', type: 'dakuten', row: 'g' },
  { kana: 'ギ', romaji: 'gi', type: 'dakuten', row: 'g' },
  { kana: 'グ', romaji: 'gu', type: 'dakuten', row: 'g' },
  { kana: 'ゲ', romaji: 'ge', type: 'dakuten', row: 'g' },
  { kana: 'ゴ', romaji: 'go', type: 'dakuten', row: 'g' },
  // Z-row
  { kana: 'ザ', romaji: 'za', type: 'dakuten', row: 'z' },
  { kana: 'ジ', romaji: 'ji', alternates: ['zi'], type: 'dakuten', row: 'z' },
  { kana: 'ズ', romaji: 'zu', type: 'dakuten', row: 'z' },
  { kana: 'ゼ', romaji: 'ze', type: 'dakuten', row: 'z' },
  { kana: 'ゾ', romaji: 'zo', type: 'dakuten', row: 'z' },
  // D-row
  { kana: 'ダ', romaji: 'da', type: 'dakuten', row: 'd' },
  { kana: 'ヂ', romaji: 'ji', alternates: ['di', 'dji'], type: 'dakuten', row: 'd' },
  { kana: 'ヅ', romaji: 'zu', alternates: ['du', 'dzu'], type: 'dakuten', row: 'd' },
  { kana: 'デ', romaji: 'de', type: 'dakuten', row: 'd' },
  { kana: 'ド', romaji: 'do', type: 'dakuten', row: 'd' },
  // B-row
  { kana: 'バ', romaji: 'ba', type: 'dakuten', row: 'b' },
  { kana: 'ビ', romaji: 'bi', type: 'dakuten', row: 'b' },
  { kana: 'ブ', romaji: 'bu', type: 'dakuten', row: 'b' },
  { kana: 'ベ', romaji: 'be', type: 'dakuten', row: 'b' },
  { kana: 'ボ', romaji: 'bo', type: 'dakuten', row: 'b' },
  // P-row (handakuten)
  { kana: 'パ', romaji: 'pa', type: 'handakuten', row: 'p' },
  { kana: 'ピ', romaji: 'pi', type: 'handakuten', row: 'p' },
  { kana: 'プ', romaji: 'pu', type: 'handakuten', row: 'p' },
  { kana: 'ペ', romaji: 'pe', type: 'handakuten', row: 'p' },
  { kana: 'ポ', romaji: 'po', type: 'handakuten', row: 'p' },
];

// Combo Katakana (ya, yu, yo combinations)
export const katakanaCombo: KanaCharacter[] = [
  // K-combos
  { kana: 'キャ', romaji: 'kya', type: 'combo', row: 'k' },
  { kana: 'キュ', romaji: 'kyu', type: 'combo', row: 'k' },
  { kana: 'キョ', romaji: 'kyo', type: 'combo', row: 'k' },
  // S-combos
  { kana: 'シャ', romaji: 'sha', alternates: ['sya'], type: 'combo', row: 's' },
  { kana: 'シュ', romaji: 'shu', alternates: ['syu'], type: 'combo', row: 's' },
  { kana: 'ショ', romaji: 'sho', alternates: ['syo'], type: 'combo', row: 's' },
  // T-combos
  { kana: 'チャ', romaji: 'cha', alternates: ['tya'], type: 'combo', row: 't' },
  { kana: 'チュ', romaji: 'chu', alternates: ['tyu'], type: 'combo', row: 't' },
  { kana: 'チョ', romaji: 'cho', alternates: ['tyo'], type: 'combo', row: 't' },
  // N-combos
  { kana: 'ニャ', romaji: 'nya', type: 'combo', row: 'n' },
  { kana: 'ニュ', romaji: 'nyu', type: 'combo', row: 'n' },
  { kana: 'ニョ', romaji: 'nyo', type: 'combo', row: 'n' },
  // H-combos
  { kana: 'ヒャ', romaji: 'hya', type: 'combo', row: 'h' },
  { kana: 'ヒュ', romaji: 'hyu', type: 'combo', row: 'h' },
  { kana: 'ヒョ', romaji: 'hyo', type: 'combo', row: 'h' },
  // M-combos
  { kana: 'ミャ', romaji: 'mya', type: 'combo', row: 'm' },
  { kana: 'ミュ', romaji: 'myu', type: 'combo', row: 'm' },
  { kana: 'ミョ', romaji: 'myo', type: 'combo', row: 'm' },
  // R-combos
  { kana: 'リャ', romaji: 'rya', type: 'combo', row: 'r' },
  { kana: 'リュ', romaji: 'ryu', type: 'combo', row: 'r' },
  { kana: 'リョ', romaji: 'ryo', type: 'combo', row: 'r' },
  // G-combos
  { kana: 'ギャ', romaji: 'gya', type: 'combo', row: 'g' },
  { kana: 'ギュ', romaji: 'gyu', type: 'combo', row: 'g' },
  { kana: 'ギョ', romaji: 'gyo', type: 'combo', row: 'g' },
  // J-combos
  { kana: 'ジャ', romaji: 'ja', alternates: ['zya', 'jya'], type: 'combo', row: 'z' },
  { kana: 'ジュ', romaji: 'ju', alternates: ['zyu', 'jyu'], type: 'combo', row: 'z' },
  { kana: 'ジョ', romaji: 'jo', alternates: ['zyo', 'jyo'], type: 'combo', row: 'z' },
  // B-combos
  { kana: 'ビャ', romaji: 'bya', type: 'combo', row: 'b' },
  { kana: 'ビュ', romaji: 'byu', type: 'combo', row: 'b' },
  { kana: 'ビョ', romaji: 'byo', type: 'combo', row: 'b' },
  // P-combos
  { kana: 'ピャ', romaji: 'pya', type: 'combo', row: 'p' },
  { kana: 'ピュ', romaji: 'pyu', type: 'combo', row: 'p' },
  { kana: 'ピョ', romaji: 'pyo', type: 'combo', row: 'p' },
];

// Helper to get all hiragana
export function getAllHiragana(): KanaCharacter[] {
  return [...hiraganaBasic, ...hiraganaDakuten, ...hiraganaCombo];
}

// Helper to get all katakana
export function getAllKatakana(): KanaCharacter[] {
  return [...katakanaBasic, ...katakanaDakuten, ...katakanaCombo];
}

// Helper to get quiz pool based on settings
export function getQuizPool(settings: QuizSettings): KanaCharacter[] {
  let pool: KanaCharacter[] = [];

  // Add hiragana filtered by hiraganaRows
  if (settings.hiraganaRows.length > 0) {
    const hiraganaPool = [
      ...hiraganaBasic,
      ...hiraganaDakuten,
      ...(settings.includeCombo ? hiraganaCombo : []),
    ];
    pool.push(...hiraganaPool.filter(kana => settings.hiraganaRows.includes(kana.row)));
  }

  // Add katakana filtered by katakanaRows
  if (settings.katakanaRows.length > 0) {
    const katakanaPool = [
      ...katakanaBasic,
      ...katakanaDakuten,
      ...(settings.includeCombo ? katakanaCombo : []),
    ];
    pool.push(...katakanaPool.filter(kana => settings.katakanaRows.includes(kana.row)));
  }

  return pool;
}

// Check if answer is correct (handles alternates)
export function isCorrectAnswer(kana: KanaCharacter, answer: string): boolean {
  const normalizedAnswer = answer.toLowerCase().trim();
  if (kana.romaji === normalizedAnswer) return true;
  if (kana.alternates?.includes(normalizedAnswer)) return true;
  return false;
}

// Shuffle queue for better randomization (avoids repeats and patterns)
let shuffledQueue: KanaCharacter[] = [];
let lastSettings: string = '';

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Get a random kana from the pool using Fisher-Yates shuffle queue
export function getRandomKana(pool: KanaCharacter[], settings?: QuizSettings): KanaCharacter | null {
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];

  // Create a settings fingerprint to detect changes
  const settingsKey = JSON.stringify(settings);

  // Reshuffle if settings changed or queue is empty
  if (settingsKey !== lastSettings || shuffledQueue.length === 0) {
    shuffledQueue = shuffleArray(pool);
    lastSettings = settingsKey;
  }

  return shuffledQueue.pop()!;
}

// Default settings
export const defaultQuizSettings: QuizSettings = {
  hiraganaRows: ['vowel'],
  katakanaRows: [],
  includeCombo: false,
};
