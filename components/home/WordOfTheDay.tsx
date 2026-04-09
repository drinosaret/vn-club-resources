'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen } from 'lucide-react';
import { FuriganaText, stripFurigana, toHiragana } from '@/lib/furigana';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import type { WordOfTheDayData, ExampleSentence } from '@/lib/word-of-the-day';

interface WordOfTheDayProps {
  data: WordOfTheDayData | null;
  compact?: boolean;
}

/** Render sentence with the target word bolded using wordPosition/wordLength. */
function BoldedSentence({ sentence }: { sentence: ExampleSentence }) {
  const { text, wordPosition: pos, wordLength: len } = sentence;
  if (!text) return null;

  if (pos != null && len != null && pos >= 0 && pos + len <= text.length) {
    return (
      <span className="font-jp">
        {text.slice(0, pos)}
        <strong className="font-semibold text-gray-700 dark:text-gray-200">{text.slice(pos, pos + len)}</strong>
        {text.slice(pos + len)}
      </span>
    );
  }

  return <span className="font-jp">{text}</span>;
}

export function WordOfTheDay({ data, compact }: WordOfTheDayProps) {
  const { preference } = useTitlePreference();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('is-popstate-navigation') === 'true') {
      setIsReady(true);
    } else {
      requestAnimationFrame(() => {
        setIsReady(true);
      });
    }
  }, []);

  if (!data) return null;

  const { main_reading, definitions, parts_of_speech, example_sentences, kanji_info } = data;

  const plainText = stripFurigana(main_reading.text);
  const hiragana = toHiragana(main_reading.text);
  const showReading = hiragana !== plainText;
  const primaryMeanings = definitions[0]?.meanings?.slice(0, 3) ?? [];
  const sentence = example_sentences[0];
  const sourceType = sentence?.source_type || null;
  const sourceName = sentence?.vn_title
    ? getDisplayTitle(
        { title: sentence.vn_title, title_jp: sentence.vn_title_jp ?? undefined, title_romaji: sentence.vn_title_romaji ?? undefined },
        preference,
      )
    : sentence?.source_title || sentence?.source_english || null;

  const dateStr = new Date(data.date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const card = (
        <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 md:p-6 h-full transition-opacity duration-500 ${isReady ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex flex-col sm:flex-row gap-5 md:gap-6 h-full">
            {/* Kanji Display */}
            <Link href="/word-of-the-day" className="shrink-0 self-center sm:self-start">
              <div className="flex items-center justify-center w-[140px] sm:w-[160px] md:w-[180px] aspect-square overflow-hidden rounded-lg bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border border-emerald-200 dark:border-emerald-800/40">
                <div className="text-center px-2">
                  <FuriganaText
                    text={main_reading.text}
                    className={`font-bold text-gray-900 dark:text-white font-jp leading-tight ${plainText.length <= 2 ? 'text-5xl sm:text-6xl' : plainText.length <= 4 ? 'text-3xl sm:text-4xl md:text-5xl' : 'text-2xl sm:text-3xl md:text-4xl'}`}
                    rubyClassName="text-xs font-normal text-emerald-600 dark:text-emerald-400"
                  />
                </div>
              </div>
            </Link>

            {/* Info Panel */}
            <div className="flex flex-col min-w-0 flex-1">
              {/* Badge + Date */}
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                  <BookOpen className="w-3 h-3" />
                  Word of the Day
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {dateStr}
                </span>
              </div>

              {/* Reading + POS */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                {showReading && (
                  <span className="text-sm font-jp text-gray-500 dark:text-gray-400">{hiragana}</span>
                )}
                {parts_of_speech.length > 0 && (
                  <div className="flex gap-1">
                    {parts_of_speech.slice(0, 3).map((pos) => (
                      <span key={pos} className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                        {pos}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Meanings */}
              {primaryMeanings.length > 0 && (
                <p className="text-sm text-gray-700 dark:text-gray-300 mt-1.5 line-clamp-2 leading-relaxed">
                  {primaryMeanings.join('; ')}
                </p>
              )}

              {/* Example Sentence with bolded word */}
              {sentence?.text && (
                <div className="mt-2">
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic line-clamp-2 leading-relaxed">
                    <BoldedSentence sentence={sentence} />
                  </p>
                  {sourceName && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      from{' '}
                      {sentence.vn_id ? (
                        <Link
                          href={`/vn/${sentence.vn_id}/`}
                          className="underline hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                        >
                          {sourceName}
                        </Link>
                      ) : (
                        <span>{sourceName}</span>
                      )}
                      {sourceType && sourceType !== 'Visual Novel' && ` (${sourceType})`}
                    </p>
                  )}
                </div>
              )}

              {/* Stats row */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-gray-400 dark:text-gray-500">
                {data.frequency_rank && (
                  <span>#{data.frequency_rank.toLocaleString()} freq</span>
                )}
                {data.used_in_media != null && data.used_in_media > 0 && (
                  <span>Found in {data.used_in_media.toLocaleString()} media</span>
                )}
              </div>


              {/* Kanji preview */}
              {kanji_info.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {kanji_info.slice(0, 5).map((k) => (
                    <span
                      key={k.character}
                      className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400"
                    >
                      <span className="font-jp font-medium text-base text-gray-700 dark:text-gray-300">{k.character}</span>
                      {k.jlpt_level != null && (
                        <span className="text-emerald-600 dark:text-emerald-400">N{k.jlpt_level}</span>
                      )}
                    </span>
                  ))}
                </div>
              )}

              {/* CTA Link */}
              <Link
                href="/word-of-the-day"
                className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors mt-3 md:mt-auto pt-1"
              >
                See details
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
  );

  if (compact) return card;

  return (
    <section className="pb-4 bg-gray-50 dark:bg-gray-900/50">
      <div className="container mx-auto px-4 max-w-6xl">
        {card}
      </div>
    </section>
  );
}
