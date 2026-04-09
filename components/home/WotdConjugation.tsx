'use client';

import { stripFurigana } from '@/lib/furigana';

interface ConjugationRow {
  form: string;
  japanese: string;
  romaji: string;
}

/**
 * Japanese verb/adjective conjugation table.
 * Generates conjugations from the dictionary form and POS tags.
 */

// Godan verb stem mappings: final kana -> conjugation bases
const GODAN_MAP: Record<string, { a: string; i: string; e: string; o: string; te: string; ta: string }> = {
  'う': { a: 'わ', i: 'い', e: 'え', o: 'お', te: 'って', ta: 'った' },
  'く': { a: 'か', i: 'き', e: 'け', o: 'こ', te: 'いて', ta: 'いた' },
  'ぐ': { a: 'が', i: 'ぎ', e: 'げ', o: 'ご', te: 'いで', ta: 'いだ' },
  'す': { a: 'さ', i: 'し', e: 'せ', o: 'そ', te: 'して', ta: 'した' },
  'つ': { a: 'た', i: 'ち', e: 'て', o: 'と', te: 'って', ta: 'った' },
  'ぬ': { a: 'な', i: 'に', e: 'ね', o: 'の', te: 'んで', ta: 'んだ' },
  'ぶ': { a: 'ば', i: 'び', e: 'べ', o: 'ぼ', te: 'んで', ta: 'んだ' },
  'む': { a: 'ま', i: 'み', e: 'め', o: 'も', te: 'んで', ta: 'んだ' },
  'る': { a: 'ら', i: 'り', e: 'れ', o: 'ろ', te: 'って', ta: 'った' },
};

// Special case: 行く
const SPECIAL_IKU = { te: 'って', ta: 'った' };

function conjugateGodan(stem: string, ending: string): ConjugationRow[] | null {
  const map = GODAN_MAP[ending];
  if (!map) return null;

  const isIku = stem + ending === 'いく' || stem + ending === 'ゆく';
  const te = isIku ? SPECIAL_IKU.te : map.te;
  const ta = isIku ? SPECIAL_IKU.ta : map.ta;

  return [
    { form: 'Dictionary', japanese: stem + ending, romaji: 'Plain present' },
    { form: 'Polite', japanese: stem + map.i + 'ます', romaji: 'Polite present' },
    { form: 'Negative', japanese: stem + map.a + 'ない', romaji: 'Plain negative' },
    { form: 'Past', japanese: stem + ta, romaji: 'Plain past' },
    { form: 'Te-form', japanese: stem + te, romaji: 'Connective' },
    { form: 'Potential', japanese: stem + map.e + 'る', romaji: 'Can do' },
    { form: 'Passive', japanese: stem + map.a + 'れる', romaji: 'Is done' },
    { form: 'Causative', japanese: stem + map.a + 'せる', romaji: 'Make do' },
    { form: 'Imperative', japanese: stem + map.e, romaji: 'Command' },
    { form: 'Volitional', japanese: stem + map.o + 'う', romaji: 'Let\'s / intend to' },
    { form: 'Conditional', japanese: stem + map.e + 'ば', romaji: 'If' },
  ];
}

function conjugateIchidan(stem: string): ConjugationRow[] {
  return [
    { form: 'Dictionary', japanese: stem + 'る', romaji: 'Plain present' },
    { form: 'Polite', japanese: stem + 'ます', romaji: 'Polite present' },
    { form: 'Negative', japanese: stem + 'ない', romaji: 'Plain negative' },
    { form: 'Past', japanese: stem + 'た', romaji: 'Plain past' },
    { form: 'Te-form', japanese: stem + 'て', romaji: 'Connective' },
    { form: 'Potential', japanese: stem + 'られる', romaji: 'Can do' },
    { form: 'Passive', japanese: stem + 'られる', romaji: 'Is done' },
    { form: 'Causative', japanese: stem + 'させる', romaji: 'Make do' },
    { form: 'Imperative', japanese: stem + 'ろ', romaji: 'Command' },
    { form: 'Volitional', japanese: stem + 'よう', romaji: 'Let\'s / intend to' },
    { form: 'Conditional', japanese: stem + 'れば', romaji: 'If' },
  ];
}

function conjugateIAdj(stem: string): ConjugationRow[] {
  return [
    { form: 'Dictionary', japanese: stem + 'い', romaji: 'Plain present' },
    { form: 'Polite', japanese: stem + 'いです', romaji: 'Polite present' },
    { form: 'Negative', japanese: stem + 'くない', romaji: 'Plain negative' },
    { form: 'Past', japanese: stem + 'かった', romaji: 'Plain past' },
    { form: 'Te-form', japanese: stem + 'くて', romaji: 'Connective' },
    { form: 'Adverb', japanese: stem + 'く', romaji: 'Adverbial form' },
    { form: 'Conditional', japanese: stem + 'ければ', romaji: 'If' },
  ];
}

function conjugateNaAdj(word: string): ConjugationRow[] {
  return [
    { form: 'Dictionary', japanese: word, romaji: 'Plain present' },
    { form: 'Polite', japanese: word + 'です', romaji: 'Polite present' },
    { form: 'Negative', japanese: word + 'じゃない', romaji: 'Plain negative' },
    { form: 'Past', japanese: word + 'だった', romaji: 'Plain past' },
    { form: 'Te-form', japanese: word + 'で', romaji: 'Connective' },
    { form: 'Adverb', japanese: word + 'に', romaji: 'Adverbial form' },
    { form: 'Conditional', japanese: word + 'なら(ば)', romaji: 'If' },
  ];
}

function toHiraganaFromReading(text: string): string {
  // Strip furigana brackets and get the reading
  const parts = text.match(/([^[\]]+?)(?:\[([^\]]+)\])|([^[\]]+)/g);
  if (!parts) return stripFurigana(text);
  let result = '';
  for (const part of parts) {
    const match = part.match(/^([^[\]]+?)\[([^\]]+)\]$/);
    if (match) {
      result += match[2]; // use reading
    } else {
      result += part;
    }
  }
  return result;
}

export function getConjugations(readingText: string, partsOfSpeech: string[]): { type: string; rows: ConjugationRow[] } | null {
  const plain = stripFurigana(readingText); // 接近戦, 食べる, 御座る
  const hiragana = toHiraganaFromReading(readingText); // せっきんせん, たべる, ござる
  if (!plain) return null;

  // For verbs/adj: the kanji stem is everything except the trailing kana ending
  // e.g. 食べる -> stem "食べ", ending "る"
  // e.g. 書く -> stem "書", ending "く"

  const isV1 = partsOfSpeech.includes('v1');
  const isV5 = partsOfSpeech.some(p => p.startsWith('v5'));
  const isIAdj = partsOfSpeech.includes('adj-i');
  const isNaAdj = partsOfSpeech.includes('adj-na');

  if (isV1) {
    const stem = plain.slice(0, -1); // drop る
    return { type: 'Ichidan verb', rows: conjugateIchidan(stem) };
  }

  if (isV5) {
    const ending = hiragana.slice(-1); // get the kana ending for conjugation logic
    const kanjiStem = plain.slice(0, -1);
    const rows = conjugateGodan(kanjiStem, ending);
    if (rows) return { type: 'Godan verb', rows };
  }

  if (isIAdj) {
    const stem = plain.slice(0, -1); // drop い
    return { type: 'i-adjective', rows: conjugateIAdj(stem) };
  }

  if (isNaAdj) {
    return { type: 'na-adjective', rows: conjugateNaAdj(plain) };
  }

  if (partsOfSpeech.includes('vs') || partsOfSpeech.includes('vs-i')) {
    return {
      type: 'suru verb',
      rows: [
        { form: 'Dictionary', japanese: plain + 'する', romaji: 'Plain present' },
        { form: 'Polite', japanese: plain + 'します', romaji: 'Polite present' },
        { form: 'Negative', japanese: plain + 'しない', romaji: 'Plain negative' },
        { form: 'Past', japanese: plain + 'した', romaji: 'Plain past' },
        { form: 'Te-form', japanese: plain + 'して', romaji: 'Connective' },
        { form: 'Potential', japanese: plain + 'できる', romaji: 'Can do' },
        { form: 'Passive', japanese: plain + 'される', romaji: 'Is done' },
        { form: 'Causative', japanese: plain + 'させる', romaji: 'Make do' },
        { form: 'Volitional', japanese: plain + 'しよう', romaji: 'Let\'s / intend to' },
        { form: 'Conditional', japanese: plain + 'すれば', romaji: 'If' },
      ],
    };
  }

  if (partsOfSpeech.includes('n') || partsOfSpeech.includes('pn')) {
    return {
      type: 'Noun',
      rows: [
        { form: 'Plain', japanese: plain + 'だ', romaji: 'Is (plain)' },
        { form: 'Polite', japanese: plain + 'です', romaji: 'Is (polite)' },
        { form: 'Negative', japanese: plain + 'じゃない', romaji: 'Is not (plain)' },
        { form: 'Past', japanese: plain + 'だった', romaji: 'Was (plain)' },
        { form: 'Past polite', japanese: plain + 'でした', romaji: 'Was (polite)' },
        { form: 'Te-form', japanese: plain + 'で', romaji: 'Connective' },
        { form: 'Conditional', japanese: plain + 'なら(ば)', romaji: 'If it is' },
        { form: 'As subject', japanese: plain + 'が', romaji: 'Subject marker' },
        { form: 'As topic', japanese: plain + 'は', romaji: 'Topic marker' },
        { form: 'As object', japanese: plain + 'を', romaji: 'Object marker' },
        { form: 'Possessive', japanese: plain + 'の', romaji: 'Of / belonging to' },
      ],
    };
  }

  if (partsOfSpeech.includes('adv')) {
    return {
      type: 'Adverb',
      rows: [
        { form: 'Plain', japanese: plain, romaji: 'As adverb' },
        { form: 'With する', japanese: plain + 'する', romaji: 'To do (adverbially)' },
        { form: 'With と', japanese: plain + 'と', romaji: 'Quotative / manner' },
        { form: 'With に', japanese: plain + 'に', romaji: 'Directional / purpose' },
      ],
    };
  }

  return {
    type: partsOfSpeech[0] || 'Word',
    rows: [
      { form: 'Plain', japanese: plain + 'だ', romaji: 'Is (plain)' },
      { form: 'Polite', japanese: plain + 'です', romaji: 'Is (polite)' },
      { form: 'Negative', japanese: plain + 'じゃない', romaji: 'Is not' },
      { form: 'Past', japanese: plain + 'だった', romaji: 'Was' },
    ],
  };
}

export function WotdConjugation({ readingText, partsOfSpeech }: { readingText: string; partsOfSpeech: string[] }) {
  const result = getConjugations(readingText, partsOfSpeech);
  if (!result) return null;

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Conjugations</h2>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{result.type}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        {result.rows.map((row) => (
          <div key={row.form} className="flex items-baseline justify-between py-1.5 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-20 shrink-0">{row.form}</span>
              <span className="font-jp text-gray-900 dark:text-white">{row.japanese}</span>
            </div>
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">{row.romaji}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
