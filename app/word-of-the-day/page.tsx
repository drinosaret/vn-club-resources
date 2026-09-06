import Link from '@/components/Link';
import { ExternalLink } from 'lucide-react';
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

// The date in the query string reaches the nav, which formats it and steps a day either way,
// so anything that is not a real calendar day is dropped in favour of the current pick.
function requestedDate(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value))
    ? value
    : undefined;
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ date?: string }> }): Promise<Metadata> {
  const params = await searchParams;
  const wordData = await getWordOfTheDay(requestedDate(params.date));

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
        <strong className="wd-hit">{text.slice(pos, pos + len)}</strong>
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
 *
 * Drawn in the accent token rather than in a literal colour, so the diagram
 * follows the theme the rest of the page is painted in.
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
    <div className="wd-pitch space-y-1">
      <span className="fig-label">Pitch accent</span>
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
              <svg width={svgWidth} height={28}>
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
                      stroke="var(--ai)"
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
                    fill={i < morae.length ? 'var(--ai)' : 'none'}
                    stroke={i < morae.length ? 'none' : 'var(--ai)'}
                    strokeWidth={i < morae.length ? 0 : 1.5}
                  />
                ))}
              </svg>
              {/* Mora labels */}
              <div className="flex" style={{ width: svgWidth }}>
                {morae.map((mora, i) => (
                  <span
                    key={i}
                    className="wd-pitch-mora"
                    style={{ width: moraWidth }}
                  >
                    {mora}
                  </span>
                ))}
                <span
                  className="wd-pitch-tail"
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
    <section className="panel p-5 pt-7">
      <h2 className="nameplate dg-plate">Forms</h2>
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
              className={i === 0 ? 'wd-form wd-form--main' : 'wd-form'}
            >
              <p className="wd-form-text">
                {plainForm}
              </p>
              {pctLabel && (
                <p className="wd-form-pct">
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
    <section className="panel p-5 pt-7">
      <h2 className="nameplate dg-plate">Kanji</h2>
      <div className="space-y-6">
        {kanjiInfo.map((k) => (
          <div key={k.character} className="space-y-4">
            {/* Header: character + metadata */}
            <div className="flex gap-4 items-start">
              <a
                href={`https://jiten.moe/kanji/${encodeURIComponent(k.character)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="wd-kanji"
              >
                {k.character}
              </a>
              <div className="min-w-0 flex-1">
                {/* Meanings */}
                {k.meanings?.length > 0 && (
                  <p className="text-sm text-[color:var(--text-secondary)]">
                    {k.meanings.join(', ')}
                  </p>
                )}
                {/* Heisig keyword */}
                {k.heisig_en && (
                  <p className="mt-1 text-xs text-[color:var(--text-faint)]">
                    Heisig: <span className="text-[color:var(--nezu)]">{k.heisig_en}</span>
                  </p>
                )}
                {/* Marks */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {k.jlpt_level != null && (
                    <span className="st-badge">
                      N{k.jlpt_level}
                    </span>
                  )}
                  {gradeLabel(k.grade) && (
                    <span className="st-badge">
                      {gradeLabel(k.grade)}
                    </span>
                  )}
                  {k.stroke_count != null && (
                    <span className="st-badge">
                      {k.stroke_count} strokes
                    </span>
                  )}
                  {k.frequency != null && (
                    <span className="st-badge">
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
                    <span className="fig-label">On&apos;yomi</span>
                    <p className="wd-kana">
                      {k.on_readings.join('、')}
                    </p>
                  </div>
                )}
                {k.kun_readings?.length > 0 && (
                  <div>
                    <span className="fig-label">Kun&apos;yomi</span>
                    <p className="wd-kana">
                      {k.kun_readings.join('、')}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Common compounds */}
            {k.compounds?.length > 0 && (
              <div>
                <span className="fig-label">Common Compounds</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-1.5">
                  {k.compounds.map((c, i) => (
                    <div key={i} className="wd-comp">
                      <span className="wd-comp-word">{c.written}</span>
                      <span className="wd-comp-reading">({c.reading})</span>
                      <span className="wd-comp-gloss truncate">{c.meanings.join(', ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Separator between kanji */}
            {kanjiInfo.indexOf(k) < kanjiInfo.length - 1 && (
              <hr className="wd-rule" />
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
    <section className="panel p-5 pt-7">
      <h2 className="nameplate dg-plate">Related VNDB Tags</h2>
      <p className="wd-credit mb-3">
        Tags common across the top 50 VNs where this word appears most
      </p>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <Link
            key={tag.id}
            href={`/stats/tag/${tag.id}`}
            className="st-chip wd-focus"
          >
            <span>{tag.name}</span>
            <span className="text-[color:var(--text-faint)]">in <span className="st-num">{tag.word_vn_count}</span> VNs</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function HistorySection({ history }: { history: WordOfTheDayHistoryItem[] }) {
  if (!history.length) return null;

  return (
    <section className="panel p-5 pt-7">
      <h2 className="nameplate dg-plate">Recent Words</h2>
      <div>
        {history.map((item) => (
          <Link
            key={item.date}
            href={`/word-of-the-day?date=${item.date}`}
            className="choice wd-focus"
          >
            <span className={`wd-past-word ${
              stripFurigana(item.text).length <= 2 ? 'text-2xl w-16' :
              stripFurigana(item.text).length <= 4 ? 'text-lg w-20' :
              'text-base w-24'
            }`}>
              {stripFurigana(item.text)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline flex-wrap gap-2">
                <span className="wd-past-reading">{toHiragana(item.text)}</span>
                {item.parts_of_speech?.length > 0 && (
                  <span className="wd-past-meta">{item.parts_of_speech.join(' · ')}</span>
                )}
                <span className="wd-past-meta">
                  {new Date(item.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </span>
              {item.meanings.length > 0 && (
                <span className="wd-past-gloss block truncate">
                  {item.meanings.join('; ')}
                </span>
              )}
            </span>
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
  const requested = requestedDate(params.date);
  const [wordData, history] = await Promise.all([
    getWordOfTheDay(requested),
    getWordOfTheDayHistory(6),
  ]);

  const plainText = wordData ? stripFurigana(wordData.main_reading.text) : '';
  const serverToday = new Date().toISOString().split('T')[0];
  const currentDate = wordData?.date || requested || serverToday;

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
      <div className="min-h-screen bg-[color:var(--ground)]">
        <div className="container mx-auto px-4 max-w-4xl py-8 md:py-12">
          {/* Date Navigation */}
          <WotdDateNav currentDate={currentDate} latestDate={serverToday} />

          {wordData ? (
            <div className="space-y-6 mt-6">
              {/* Hero Word Display */}
              <div className="panel p-6 pt-8 md:p-8 md:pt-9">
                {/* The plate names the panel, so no icon sits beside it. */}
                <span className="nameplate dg-plate">Word of the Day</span>
                <div className="flex justify-end mb-4">
                  <WotdShareButton data={wordData} />
                </div>

                <div className="wotd-hero-layout">
                  {/* Large word display */}
                  <div className="wotd-word-display">
                    <div className="wd-word-box">
                      <div>
                      <h1 className={`wd-word ${plainText.length <= 2 ? 'text-5xl md:text-6xl' : plainText.length <= 4 ? 'text-3xl md:text-4xl' : 'text-2xl md:text-3xl'}`}>
                        <FuriganaText
                          text={wordData.main_reading.text}
                          rubyClassName="dg-ruby"
                        />
                      </h1>
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                        {wordData.jisho?.jlpt && wordData.jisho.jlpt.length > 0 && (
                          <span className="st-badge">
                            {wordData.jisho.jlpt[0].replace('jlpt-', '').toUpperCase()}
                          </span>
                        )}
                        {wordData.jisho && wordData.jisho.is_common && (
                          <span className="st-badge">
                            Common
                          </span>
                        )}
                      </div>
                      {/* Stats */}
                      {(wordData.frequency_rank || wordData.used_in_vns) && (
                        <div>
                          {wordData.frequency_rank && (
                            <p className="dg-word-count">
                              Rank <span className="dg-word-figure">#{wordData.frequency_rank.toLocaleString()}</span>
                            </p>
                          )}
                          <p className="wd-credit mt-1">
                            {wordData.used_in_vns != null && wordData.used_in_vns > 0 && (
                              <span>Found in <span className="st-num">{wordData.used_in_vns.toLocaleString()}</span> VNs</span>
                            )}
                            {wordData.used_in_vns != null && wordData.used_in_vns > 0 && wordData.used_in_media != null && wordData.used_in_media > 0 && ' · '}
                            {wordData.used_in_media != null && wordData.used_in_media > 0 && (
                              <span><span className="st-num">{wordData.used_in_media.toLocaleString()}</span> total media</span>
                            )}
                          </p>
                        </div>
                      )}
                      {/* Audio pronunciation */}
                      <a
                        href={`https://forvo.com/word/${encodeURIComponent(plainText)}/#ja`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="wd-out wd-out--tight mt-3"
                      >
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
                      <h2 className="fig-label">Meanings</h2>
                      {wordData.definitions.map((defn, i) => {
                        const senseNote = wordData.jisho?.sense_notes?.[i];
                        return (
                          <div key={i}>
                            {defn.pos.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-1">
                                {defn.pos.map((p) => (
                                  <span key={p} className="st-badge">
                                    {p}
                                  </span>
                                ))}
                                {defn.misc?.map((m) => (
                                  <span key={m} className="st-badge">
                                    {m}
                                  </span>
                                ))}
                              </div>
                            )}
                            <ol className="list-decimal list-inside space-y-0.5">
                              {defn.meanings.map((meaning, j) => (
                                <li key={j} className="text-sm text-[color:var(--text-secondary)]">
                                  {meaning}
                                </li>
                              ))}
                            </ol>
                            {senseNote?.info && senseNote.info.length > 0 && (
                              <p className="mt-1 text-xs italic text-[color:var(--text-faint)]">
                                {senseNote.info.join('; ')}
                              </p>
                            )}
                            {senseNote?.see_also && senseNote.see_also.length > 0 && (
                              <p className="mt-1 text-xs text-[color:var(--text-faint)]">
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
                <FormsSection readings={wordData.alternative_readings} wordId={wordData.word_id} />
              )}

              {/* Example Sentences */}
              {wordData.example_sentences.length > 0 && (
                <section className="panel p-5 pt-7">
                  <h2 className="nameplate dg-plate">Example Sentences</h2>
                  <p className="wd-credit mb-3">
                    from <a href="https://jiten.moe" target="_blank" rel="noopener noreferrer">Jiten</a>
                  </p>
                  <div className="space-y-3">
                    {wordData.example_sentences.map((sentence, i) => {
                      if (!sentence.text) return null;
                      return (
                        <div key={i} className="wd-quote">
                          <p className="dg-example-text">
                            <BoldedSentence sentence={sentence} />
                          </p>
                          <WotdSentenceSource sentence={sentence} className="dg-example-source" />
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Bilingual Sentences (Tatoeba) */}
              {wordData.tatoeba_sentences && wordData.tatoeba_sentences.length > 0 && (
                <section className="panel p-5 pt-7">
                  <h2 className="nameplate dg-plate">Sentences with Translation</h2>
                  <p className="wd-credit mb-3">
                    from <a href="https://tatoeba.org" target="_blank" rel="noopener noreferrer">Tatoeba</a>
                  </p>
                  <div className="space-y-3">
                    {wordData.tatoeba_sentences.slice(0, 3).map((s, i) => {
                      // Highlight the word in the sentence
                      const idx = s.japanese.indexOf(plainText);
                      const jpContent = idx >= 0 ? (
                        <span className="font-jp">
                          {s.japanese.slice(0, idx)}
                          <strong className="wd-hit">{plainText}</strong>
                          {s.japanese.slice(idx + plainText.length)}
                        </span>
                      ) : (
                        <span className="font-jp">{s.japanese}</span>
                      );
                      return (
                      <div key={i} className="wd-quote">
                        <p className="dg-example-text">{jpContent}</p>
                        <p className="wd-trans">{s.english}</p>
                      </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Kanji */}
              {wordData.kanji_info.length > 0 && (
                <KanjiBreakdown kanjiInfo={wordData.kanji_info} />
              )}

              {/* Conjugation / Forms Table */}
              {wordData.parts_of_speech.length > 0 && (
                <WotdConjugation readingText={wordData.main_reading.text} partsOfSpeech={wordData.parts_of_speech} />
              )}

              {/* Related VNDB Tags */}
              {wordData.related_tags?.length > 0 && (
                <RelatedTagsSection tags={wordData.related_tags} />
              )}

              {/* External Links */}
              <section className="panel p-5 pt-7">
                <h2 className="nameplate dg-plate">Look Up</h2>
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
                      className="wd-out"
                    >
                      {label}
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ))}
                </div>
              </section>

              {/* History */}
              {history.filter((h) => h.date !== wordData.date).length > 0 && (
                <HistorySection history={history.filter((h) => h.date !== wordData.date)} />
              )}
            </div>
          ) : (
            <div className="text-center py-20">
              <h1 className="sec-title">No Word of the Day yet</h1>
              <p className="sec-sub mb-6">
                Check back soon. A new word is selected daily.
              </p>
              <Link href="/" className="sec-more wd-focus">
                Back to home
                <span aria-hidden> →</span>
              </Link>
            </div>
          )}

          {/* Attribution */}
          <div className="wd-credit mt-8 text-center space-y-2">
            <p>
              Word data and example sentences provided by{' '}
              <a href="https://jiten.moe" target="_blank" rel="noopener noreferrer">Jiten</a>.
            </p>
            <p>
              Kanji details and compound words from{' '}
              <a href="https://kanjiapi.dev" target="_blank" rel="noopener noreferrer">KanjiAPI</a>.
              {' '}Visual novel data from{' '}
              <a href="https://vndb.org" target="_blank" rel="noopener noreferrer">VNDB</a>.
            </p>
            <p>
              Dictionary data from{' '}
              <a href="https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project" target="_blank" rel="noopener noreferrer">JMdict</a>,{' '}
              <a href="https://www.edrdg.org/wiki/index.php/KANJIDIC_Project" target="_blank" rel="noopener noreferrer">KANJIDIC</a>, and{' '}
              <a href="https://www.edrdg.org/wiki/index.php/JMnedict" target="_blank" rel="noopener noreferrer">JMnedict</a>,
              property of the{' '}
              <a href="https://www.edrdg.org/" target="_blank" rel="noopener noreferrer">Electronic Dictionary Research and Development Group</a>,
              used in conformance with the Group&rsquo;s{' '}
              <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noopener noreferrer">licence</a>.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
