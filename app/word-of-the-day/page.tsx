import Link from 'next/link';
import { BookOpen, ExternalLink, ArrowRight } from 'lucide-react';
import { getWordOfTheDay, getWordOfTheDayHistory } from '@/lib/word-of-the-day';
import { generatePageMetadata, generateBreadcrumbJsonLd, safeJsonLdStringify } from '@/lib/metadata-utils';
import { FuriganaText, stripFurigana, toHiragana } from '@/lib/furigana';
import { WotdFeaturedVN } from '@/components/home/WotdFeaturedVN';
import { WotdSentenceSource } from '@/components/home/WotdSentenceSource';
import { WotdConjugation } from '@/components/home/WotdConjugation';
import { WotdDateNav } from '@/components/home/WotdDateNav';
import { WotdShareButton } from '@/components/home/WotdShareButton';
import type { Metadata } from 'next';
import type { WordOfTheDayData, WordOfTheDayHistoryItem, ExampleSentence, RelatedTag } from '@/lib/word-of-the-day';

export const revalidate = 300;

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ date?: string }> }): Promise<Metadata> {
  const params = await searchParams;
  const wordData = await getWordOfTheDay(params.date);

  if (wordData) {
    const word = stripFurigana(wordData.main_reading.text);
    const meanings = wordData.definitions[0]?.meanings?.slice(0, 2).join(', ') || '';
    return generatePageMetadata({
      title: `${word} - Japanese Word of the Day`,
      description: `${word}: ${meanings}. Daily Japanese vocabulary with meanings, conjugations, pitch accent, and example sentences from visual novels.`,
      path: '/word-of-the-day',
    });
  }

  return generatePageMetadata({
    title: 'Japanese Word of the Day',
    description: 'A new Japanese word every day with meanings, conjugations, pitch accent, example sentences from visual novels, and kanji breakdown.',
    path: '/word-of-the-day',
  });
}

function BoldedSentence({ sentence }: { sentence: ExampleSentence }) {
  const { text, wordPosition: pos, wordLength: len } = sentence;
  if (!text) return null;

  if (pos != null && len != null && pos >= 0 && pos + len <= text.length) {
    return (
      <span className="font-jp">
        {text.slice(0, pos)}
        <strong className="font-bold text-emerald-700 dark:text-emerald-300">{text.slice(pos, pos + len)}</strong>
        {text.slice(pos + len)}
      </span>
    );
  }

  return <span className="font-jp">{text}</span>;
}

/**
 * Split a kana string into morae (e.g. "ござる" → ["ご","ざ","る"]).
 * Small kana (ゃゅょ etc.) attach to the previous mora.
 */
function splitMorae(reading: string): string[] {
  const small = 'ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ';
  const extenders = 'ーｰ'; // long vowel marks attach to previous mora
  const morae: string[] = [];
  for (const ch of reading) {
    if ((small.includes(ch) || extenders.includes(ch)) && morae.length > 0) {
      morae[morae.length - 1] += ch;
    } else {
      morae.push(ch);
    }
  }
  return morae;
}

/**
 * Render pitch accent as an SVG diagram with dots and lines over kana.
 * accent=0: heiban (low → high, stays high including particle)
 * accent=1: atamadaka (high → low)
 * accent=N: rises then drops after mora N
 */
function PitchAccentDisplay({ accents, reading }: { accents: number[]; reading: string }) {
  if (!accents.length || !reading) return null;
  const morae = splitMorae(reading);
  if (!morae.length) return null;

  const moraWidth = morae.length <= 5 ? 28 : morae.length <= 8 ? 22 : 18;
  const highY = 4;
  const lowY = 22;
  const dotR = 3.5;

  return (
    <div className="space-y-1">
      <span className="text-sm text-gray-500 dark:text-gray-400">Pitch accent</span>
      <div className="flex flex-wrap gap-6">
        {accents.map((accent, ai) => {
          // Include trailing particle position
          const positions = morae.length + 1;
          const isHigh = Array.from({ length: positions }, (_, i) => {
            if (accent === 0) return i > 0; // heiban: low, then all high (incl. particle)
            if (accent === 1) return i === 0; // atamadaka: first high, rest low
            // nakadaka: first low, high until accent position, then low
            return i > 0 && i < accent;
          });

          const svgWidth = positions * moraWidth;

          return (
            <div key={ai}>
              <svg width={svgWidth} height={28} className="block">
                {/* Lines between dots */}
                {isHigh.map((high, i) => {
                  if (i >= positions - 1) return null;
                  const nextHigh = isHigh[i + 1];
                  return (
                    <line
                      key={`l${i}`}
                      x1={i * moraWidth + moraWidth / 2}
                      y1={high ? highY : lowY}
                      x2={(i + 1) * moraWidth + moraWidth / 2}
                      y2={nextHigh ? highY : lowY}
                      className="stroke-emerald-500 dark:stroke-emerald-400"
                      strokeWidth={2}
                    />
                  );
                })}
                {/* Dots */}
                {isHigh.map((high, i) => (
                  <circle
                    key={`d${i}`}
                    cx={i * moraWidth + moraWidth / 2}
                    cy={high ? highY : lowY}
                    r={i < morae.length ? dotR : 2.5}
                    className={i < morae.length
                      ? 'fill-emerald-500 dark:fill-emerald-400'
                      : 'fill-none stroke-emerald-500 dark:stroke-emerald-400'
                    }
                    strokeWidth={i < morae.length ? 0 : 1.5}
                  />
                ))}
              </svg>
              {/* Mora labels */}
              <div className="flex" style={{ width: svgWidth }}>
                {morae.map((mora, i) => (
                  <span
                    key={i}
                    className="text-sm font-jp text-gray-700 dark:text-gray-300 text-center"
                    style={{ width: moraWidth }}
                  >
                    {mora}
                  </span>
                ))}
                <span
                  className="text-xs text-gray-400 dark:text-gray-500 text-center"
                  style={{ width: moraWidth }}
                >
                  &#x25CB;
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FormsSection({ readings, wordId }: { readings: WordOfTheDayData['alternative_readings']; wordId: number }) {
  if (readings.length <= 1) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Forms</h2>
      <div className="flex flex-wrap gap-3">
        {readings.map((r, i) => {
          const pct = r.frequency_percentage;
          const pctLabel = pct != null
            ? pct >= 1 ? `${pct.toFixed(1)}%` : pct > 0 ? '<0.1%' : '0%'
            : null;
          const plainForm = stripFurigana(r.text);
          return (
            <a
              key={i}
              href={`https://jiten.moe/vocabulary/${wordId}/${r.reading_index}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`px-4 py-2.5 rounded-lg border text-center hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors ${
                i === 0
                  ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-900/10'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              }`}
            >
              <p className="text-lg font-jp font-semibold text-gray-900 dark:text-white">
                {plainForm}
              </p>
              {pctLabel && (
                <p className={`text-xs mt-0.5 ${i === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                  {pctLabel}
                </p>
              )}
            </a>
          );
        })}
      </div>
    </section>
  );
}

function gradeLabel(grade: number | null): string | null {
  if (grade == null) return null;
  if (grade >= 1 && grade <= 6) return `Grade ${grade}`;
  if (grade === 8) return 'Junior high';
  if (grade === 9 || grade === 10) return 'Jinmeiyou';
  return null;
}

function KanjiBreakdown({ kanjiInfo }: { kanjiInfo: WordOfTheDayData['kanji_info'] }) {
  if (!kanjiInfo.length) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Kanji</h2>
      <div className="space-y-6">
        {kanjiInfo.map((k) => (
          <div key={k.character} className="space-y-4">
            {/* Header: character + metadata */}
            <div className="flex gap-4 items-start">
              <a
                href={`https://jiten.moe/kanji/${encodeURIComponent(k.character)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 flex items-center justify-center w-20 h-20 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border border-emerald-200 dark:border-emerald-800/40 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
              >
                <span className="text-4xl font-bold font-jp text-gray-900 dark:text-white">{k.character}</span>
              </a>
              <div className="min-w-0 flex-1">
                {/* Meanings */}
                {k.meanings?.length > 0 && (
                  <p className="text-gray-700 dark:text-gray-300 font-medium">
                    {k.meanings.join(', ')}
                  </p>
                )}
                {/* Heisig keyword */}
                {k.heisig_en && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    Heisig: <span className="text-gray-500 dark:text-gray-400 font-medium">{k.heisig_en}</span>
                  </p>
                )}
                {/* Badges */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {k.jlpt_level != null && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                      N{k.jlpt_level}
                    </span>
                  )}
                  {gradeLabel(k.grade) && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                      {gradeLabel(k.grade)}
                    </span>
                  )}
                  {k.stroke_count != null && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                      {k.stroke_count} strokes
                    </span>
                  )}
                  {k.frequency != null && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                      #{k.frequency.toLocaleString()} freq
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Readings */}
            {(k.on_readings?.length > 0 || k.kun_readings?.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {k.on_readings?.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">On&apos;yomi</span>
                    <p className="font-jp text-sm text-gray-700 dark:text-gray-300 mt-0.5">
                      {k.on_readings.join('、')}
                    </p>
                  </div>
                )}
                {k.kun_readings?.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">Kun&apos;yomi</span>
                    <p className="font-jp text-sm text-gray-700 dark:text-gray-300 mt-0.5">
                      {k.kun_readings.join('、')}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Common compounds */}
            {k.compounds?.length > 0 && (
              <div>
                <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">Common Compounds</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-1.5">
                  {k.compounds.map((c, i) => (
                    <div key={i} className="flex items-baseline gap-2 text-sm">
                      <span className="font-jp font-medium text-gray-800 dark:text-gray-200 shrink-0">{c.written}</span>
                      <span className="font-jp text-gray-400 dark:text-gray-500 text-xs shrink-0">({c.reading})</span>
                      <span className="text-gray-500 dark:text-gray-400 truncate">{c.meanings.join(', ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Separator between kanji */}
            {kanjiInfo.indexOf(k) < kanjiInfo.length - 1 && (
              <hr className="border-gray-100 dark:border-gray-700/50" />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function RelatedTagsSection({ tags }: { tags: RelatedTag[] }) {
  if (!tags.length) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Related VNDB Tags</h2>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
        Tags common across the top 50 VNs where this word appears most
      </p>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <Link
            key={tag.id}
            href={`/stats/tag/${tag.id}`}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
              tag.category === 'cont'
                ? 'border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-900/10 text-blue-700 dark:text-blue-400 hover:border-blue-300 dark:hover:border-blue-700'
                : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <span className="font-medium">{tag.name}</span>
            <span className="text-xs opacity-60">in {tag.word_vn_count} VNs</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function HistorySection({ history }: { history: WordOfTheDayHistoryItem[] }) {
  if (!history.length) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Recent Words</h2>
      <div className="space-y-2">
        {history.map((item) => (
          <Link
            key={item.date}
            href={`/word-of-the-day?date=${item.date}`}
            className="flex items-center gap-4 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
          >
            <span className={`font-jp font-bold text-gray-900 dark:text-white shrink-0 ${
              stripFurigana(item.text).length <= 2 ? 'text-2xl w-16' :
              stripFurigana(item.text).length <= 4 ? 'text-lg w-20' :
              'text-base w-24'
            } text-center`}>
              {stripFurigana(item.text)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-jp text-gray-500 dark:text-gray-400">{toHiragana(item.text)}</span>
                {item.parts_of_speech?.length > 0 && (
                  <span className="text-xs text-gray-400 dark:text-gray-500">{item.parts_of_speech.join(' · ')}</span>
                )}
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {new Date(item.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
              {item.meanings.length > 0 && (
                <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                  {item.meanings.join('; ')}
                </p>
              )}
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />
          </Link>
        ))}
      </div>
    </section>
  );
}

export default async function WordOfTheDayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const [wordData, history] = await Promise.all([
    getWordOfTheDay(params.date),
    getWordOfTheDayHistory(6),
  ]);

  const plainText = wordData ? stripFurigana(wordData.main_reading.text) : '';
  const currentDate = wordData?.date || params.date || new Date().toISOString().split('T')[0];

  const breadcrumb = generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Word of the Day', path: '/word-of-the-day' },
  ]);

  const definedTerm = wordData ? {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name: plainText,
    description: wordData.definitions[0]?.meanings?.join('; ') || '',
    inDefinedTermSet: {
      '@type': 'DefinedTermSet',
      name: 'Japanese Vocabulary',
    },
  } : null;

  const jsonLd = definedTerm ? [breadcrumb, definedTerm] : [breadcrumb];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <div className="container mx-auto px-4 max-w-4xl py-8 md:py-12">
          {/* Date Navigation */}
          <WotdDateNav currentDate={currentDate} />

          {wordData ? (
            <div className="space-y-6 mt-6">
              {/* Hero Word Display */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 md:p-8">
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                    <BookOpen className="w-4 h-4" />
                    Word of the Day
                  </span>
                  <div className="ml-auto">
                    <WotdShareButton data={wordData} />
                  </div>
                </div>

                <div className="wotd-hero-layout gap-6">
                  {/* Large word display */}
                  <div className="wotd-word-display">
                    <div className="overflow-hidden px-6 py-5 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30 border border-emerald-200 dark:border-emerald-800/50">
                      <div className="text-center">
                      <h1 className={`font-bold text-gray-900 dark:text-white font-jp leading-none ${plainText.length <= 2 ? 'text-5xl md:text-6xl' : plainText.length <= 4 ? 'text-3xl md:text-4xl' : 'text-2xl md:text-3xl'}`}>
                        <FuriganaText
                          text={wordData.main_reading.text}
                          rubyClassName="text-base font-normal text-emerald-600 dark:text-emerald-400"
                        />
                      </h1>
                      <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-sm">
                        {wordData.jisho?.jlpt && wordData.jisho.jlpt.length > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                            {wordData.jisho.jlpt[0].replace('jlpt-', '').toUpperCase()}
                          </span>
                        )}
                        {wordData.jisho && wordData.jisho.is_common && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                            Common
                          </span>
                        )}
                      </div>
                      {/* Stats */}
                      {(wordData.frequency_rank || wordData.used_in_vns) && (
                        <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                          {wordData.frequency_rank && (
                            <p>
                              Rank <span className="font-semibold text-emerald-600 dark:text-emerald-400">#{wordData.frequency_rank.toLocaleString()}</span>
                            </p>
                          )}
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            {wordData.used_in_vns != null && wordData.used_in_vns > 0 && (
                              <span>Found in <span className="font-medium">{wordData.used_in_vns.toLocaleString()}</span> VNs</span>
                            )}
                            {wordData.used_in_vns != null && wordData.used_in_vns > 0 && wordData.used_in_media != null && wordData.used_in_media > 0 && ' · '}
                            {wordData.used_in_media != null && wordData.used_in_media > 0 && (
                              <span><span className="font-medium">{wordData.used_in_media.toLocaleString()}</span> total media</span>
                            )}
                          </p>
                        </div>
                      )}
                      {/* Audio pronunciation */}
                      <a
                        href={`https://forvo.com/word/${encodeURIComponent(plainText)}/#ja`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M11 5L6 9H2v6h4l5 4V5z" />
                        </svg>
                        Listen on Forvo
                      </a>
                      </div>
                    </div>
                  </div>

                  {/* Word info + Featured VN side by side */}
                  <div className="wotd-info-panel">
                    {/* Definitions column */}
                    <div className="wotd-definitions space-y-4">
                    {/* Meanings with POS per sense */}
                    <div className="space-y-3">
                      <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Meanings</h2>
                      {wordData.definitions.map((defn, i) => {
                        const senseNote = wordData.jisho?.sense_notes?.[i];
                        return (
                          <div key={i}>
                            {defn.pos.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-1">
                                {defn.pos.map((p) => (
                                  <span key={p} className="px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                                    {p}
                                  </span>
                                ))}
                                {defn.misc?.map((m) => (
                                  <span key={m} className="px-1.5 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                    {m}
                                  </span>
                                ))}
                              </div>
                            )}
                            <ol className="list-decimal list-inside space-y-0.5">
                              {defn.meanings.map((meaning, j) => (
                                <li key={j} className="text-gray-700 dark:text-gray-300 text-sm">
                                  {meaning}
                                </li>
                              ))}
                            </ol>
                            {senseNote?.info && senseNote.info.length > 0 && (
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 italic">
                                {senseNote.info.join('; ')}
                              </p>
                            )}
                            {senseNote?.see_also && senseNote.see_also.length > 0 && (
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                See also: {senseNote.see_also.join(', ')}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Pitch accent */}
                    <PitchAccentDisplay accents={wordData.pitch_accents} reading={toHiragana(wordData.main_reading.text)} />
                    </div>

                    {/* Featured VN - right column */}
                    {wordData.featured_vn && (
                      <WotdFeaturedVN vn={wordData.featured_vn} />
                    )}
                  </div>
                </div>
              </div>

              {/* Forms */}
              {wordData.alternative_readings.length > 1 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                  <FormsSection readings={wordData.alternative_readings} wordId={wordData.word_id} />
                </div>
              )}

              {/* Example Sentences */}
              {wordData.example_sentences.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Example Sentences</h2>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
                    from <a href="https://jiten.moe" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-300">Jiten</a>
                  </p>
                  <div className="space-y-3">
                    {wordData.example_sentences.map((sentence, i) => {
                      if (!sentence.text) return null;
                      return (
                        <div
                          key={i}
                          className="border-l-3 border-emerald-400 dark:border-emerald-500 pl-4 py-2"
                        >
                          <p className="text-gray-900 dark:text-white leading-relaxed">
                            <BoldedSentence sentence={sentence} />
                          </p>
                          <WotdSentenceSource sentence={sentence} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Bilingual Sentences (Tatoeba) */}
              {wordData.tatoeba_sentences && wordData.tatoeba_sentences.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Sentences with Translation</h2>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
                    from <a href="https://tatoeba.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-300">Tatoeba</a>
                  </p>
                  <div className="space-y-3">
                    {wordData.tatoeba_sentences.slice(0, 3).map((s, i) => {
                      // Highlight the word in the sentence
                      const idx = s.japanese.indexOf(plainText);
                      const jpContent = idx >= 0 ? (
                        <span className="font-jp">
                          {s.japanese.slice(0, idx)}
                          <strong className="font-bold text-blue-700 dark:text-blue-300">{plainText}</strong>
                          {s.japanese.slice(idx + plainText.length)}
                        </span>
                      ) : (
                        <span className="font-jp">{s.japanese}</span>
                      );
                      return (
                      <div key={i} className="border-l-3 border-blue-400 dark:border-blue-500 pl-4 py-2">
                        <p className="text-gray-900 dark:text-white leading-relaxed">{jpContent}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{s.english}</p>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Kanji */}
              {wordData.kanji_info.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                  <KanjiBreakdown kanjiInfo={wordData.kanji_info} />
                </div>
              )}

              {/* Conjugation / Forms Table */}
              {wordData.parts_of_speech.length > 0 && (
                <WotdConjugation readingText={wordData.main_reading.text} partsOfSpeech={wordData.parts_of_speech} />
              )}

              {/* Related VNDB Tags */}
              {wordData.related_tags?.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                  <RelatedTagsSection tags={wordData.related_tags} />
                </div>
              )}

              {/* External Links */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Look Up</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { label: 'Jiten', href: `https://jiten.moe/vocabulary/${wordData.word_id}/${wordData.reading_index}` },
                    { label: 'Jisho', href: `https://jisho.org/search/${encodeURIComponent(plainText)}` },
                    { label: 'Wiktionary (EN)', href: `https://en.wiktionary.org/wiki/${encodeURIComponent(plainText)}` },
                    { label: 'Wiktionary (JA)', href: `https://ja.wiktionary.org/wiki/${encodeURIComponent(plainText)}` },
                    { label: 'Immersion Kit', href: `https://www.immersionkit.com/dictionary?keyword=${encodeURIComponent(plainText)}` },
                    { label: 'Jpdb', href: `https://jpdb.io/search?q=${encodeURIComponent(plainText)}&lang=japanese#a` },
                    { label: 'Takoboto', href: `https://takoboto.jp/?q=${encodeURIComponent(plainText)}` },
                    { label: 'Weblio', href: `https://www.weblio.jp/content/${encodeURIComponent(plainText)}` },
                    { label: 'Kotobank', href: `https://kotobank.jp/word/${encodeURIComponent(plainText)}` },
                  ].map(({ label, href }) => (
                    <a
                      key={label}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-between gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-700 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                    >
                      {label}
                      <ExternalLink className="w-3 h-3 shrink-0 opacity-40" />
                    </a>
                  ))}
                </div>
              </div>

              {/* History */}
              {history.filter((h) => h.date !== wordData.date).length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                  <HistorySection history={history.filter((h) => h.date !== wordData.date)} />
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-20">
              <BookOpen className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">No Word of the Day yet</h1>
              <p className="text-gray-500 dark:text-gray-400 mb-6">
                Check back soon. A new word is selected daily.
              </p>
              <Link
                href="/"
                className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium"
              >
                Back to home
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          )}

          {/* Attribution */}
          <div className="mt-8 text-center text-xs text-gray-400 dark:text-gray-500 leading-relaxed space-y-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Word data and example sentences provided by{' '}
              <a href="https://jiten.moe" target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300">Jiten</a>.
            </p>
            <p>
              Kanji details and compound words from{' '}
              <a href="https://kanjiapi.dev" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-300">KanjiAPI</a>.
              {' '}Visual novel data from{' '}
              <a href="https://vndb.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-300">VNDB</a>.
            </p>
            <p>
              Dictionary data from{' '}
              <a href="https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-300">JMdict</a>,{' '}
              <a href="https://www.edrdg.org/wiki/index.php/KANJIDIC_Project" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-300">KANJIDIC</a>, and{' '}
              <a href="https://www.edrdg.org/wiki/index.php/JMnedict" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-300">JMnedict</a>,
              property of the{' '}
              <a href="https://www.edrdg.org/" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-300">Electronic Dictionary Research and Development Group</a>,
              used in conformance with the Group&rsquo;s{' '}
              <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-300">licence</a>.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
