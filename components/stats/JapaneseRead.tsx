'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Languages } from 'lucide-react';

import { useReadingProfile } from '@/lib/use-reading-profile';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { MeasuredTitle } from '@/lib/vndb-stats-api';
import { getDisplayTitle, useTitlePreference } from '@/lib/title-preference';

/**
 * How much Japanese text sits in the titles somebody has finished.
 *
 * Two conditions have to survive into the copy, or the figure claims something it cannot
 * know. The list does not record which language a title was read in, so this is what the
 * reader would have read in Japanese had they read these in the original, not a record that
 * they did. And jiten has measured a fraction of the database, a fraction that depends on how
 * mainstream a list is, so the figure is a floor over the measured part rather than a total.
 *
 * Placed low on the page for the same reason. Plenty of readers here are not reading in
 * Japanese at all, and a headline character count would be answering a question they did not
 * ask.
 */

interface JapaneseReadProps {
  uid: string;
}

/** Characters read, at the scale a person would actually say it. */
function readable(characters: number): string {
  if (characters >= 1_000_000) return `${(characters / 1_000_000).toFixed(1)} million`;
  if (characters >= 1_000) return `${Math.round(characters / 1_000)} thousand`;
  return characters.toLocaleString();
}

export function JapaneseRead({ uid }: JapaneseReadProps) {
  const { profile: data, loading } = useReadingProfile(uid);
  const { preference } = useTitlePreference();
  const [titles, setTitles] = useState<MeasuredTitle[] | null>(null);
  const [opened, setOpened] = useState(false);

  // Fetched when the list is first opened rather than with the card: most readers never
  // open it, and the breakdown is the larger of the two payloads.
  useEffect(() => {
    if (!opened || titles !== null) return;
    let cancelled = false;
    vndbStatsApi.getJapaneseTitles(uid).then((result) => {
      if (!cancelled) setTitles(result);
    });
    return () => {
      cancelled = true;
    };
  }, [opened, titles, uid]);

  // A reader switching profiles must not be shown the previous one's titles.
  useEffect(() => {
    setTitles(null);
    setOpened(false);
  }, [uid]);

  if (loading) return <div className="image-placeholder h-48 rounded-xl" />;

  const japanese = data?.japanese;
  // Nothing measured means nothing honest to say, and a zero would read as a fact about the
  // reader rather than about the coverage.
  if (!japanese || !japanese.measured || !japanese.characters) return null;

  return (
    <div className="rounded-xl border border-gray-200/60 bg-white p-5 shadow-md shadow-gray-200/50 dark:border-gray-700/80 dark:bg-gray-800 dark:shadow-none">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
        <Languages className="h-4 w-4 text-gray-400" />
        Japanese in what you have read
      </h2>
      <p className="mb-4 text-xs leading-relaxed text-gray-400 dark:text-gray-500">
        How much Japanese text is in the titles you have finished, if you read them in the
        original. Character counts come from{' '}
        <a
          href="https://jiten.moe/decks/media?mediaType=7"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 hover:text-gray-600 dark:hover:text-gray-300"
        >
          jiten.moe
        </a>
        , which has measured part of the database.
      </p>

      <div className="grid items-center gap-x-8 gap-y-4 sm:grid-cols-[auto_1fr]">
        <p className="text-4xl font-semibold tabular-nums text-gray-900 dark:text-white">
          {readable(japanese.characters)}
        </p>

        <div className="min-w-0">
          <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
            characters of Japanese, across the {japanese.measured.toLocaleString()} of your{' '}
            {japanese.finished.toLocaleString()} finished titles jiten has measured
            {japanese.difficulty !== null ? (
              <>
                , at an average difficulty of{' '}
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  {japanese.difficulty.toFixed(2)}
                </span>
              </>
            ) : null}
            .
          </p>

          {/* The coverage drawn rather than only stated: the whole point of the figure is how
              much of a list it stands on, and a bar says that faster than a percentage. */}
          <div className="mt-3 flex items-center gap-3">
            <div
              className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"
              role="img"
              aria-label={`${japanese.coverage.toFixed(0)}% of your finished titles have been measured`}
            >
              <div
                className="h-full rounded-full bg-primary-500"
                style={{ width: `${Math.max(2, Math.min(100, japanese.coverage))}%` }}
              />
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
              {japanese.coverage.toFixed(0)}% measured
            </span>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
            A floor rather than a total: the rest has no character count yet. Your list does not
            record which language you read a title in, so this counts what is there to read
            rather than what you read in Japanese.
          </p>
        </div>
      </div>

      {/* The total is a sum over a partial mirror, which is a lot to take on trust. Every
          title that went into it is listed here with its own count and a link to the deck the
          figure was read from, so the number can be checked rather than believed. */}
      <details
        className="group mt-4"
        onToggle={(event) => setOpened((event.target as HTMLDetailsElement).open)}
      >
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 py-1.5 text-[11px] font-medium text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
          <span className="transition-transform group-open:rotate-90">&rsaquo;</span>
          The {japanese.measured.toLocaleString()} titles behind this
        </summary>

        {titles === null ? (
          <div className="image-placeholder mt-1 h-40 rounded-md" />
        ) : (
          <div className="mt-1 max-h-72 overflow-y-auto overflow-x-hidden rounded-md border border-gray-200/70 pr-3 dark:border-gray-700/70 [scrollbar-gutter:stable]">
            <table className="w-full text-left text-[11px] tabular-nums">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900/80">
                <tr>
                  {/* The title claims the slack and the figures take only what they need.
                      Left to itself the table hands the spare width to the numeric columns,
                      which need none of it, and a name is the one thing here that cannot be
                      read at the width left over. `max-w-0` is what lets a cell truncate at
                      all inside a table. */}
                  <th scope="col" className="w-full max-w-0 px-2 py-1 font-semibold text-gray-500 dark:text-gray-400">
                    Title
                  </th>
                  <th scope="col" className="w-px whitespace-nowrap px-2 py-1 text-right font-semibold text-gray-500 dark:text-gray-400">
                    Characters
                  </th>
                  {/* Dropped on a phone. It is the least load-bearing of the three and its
                      heading is the widest word in the row. */}
                  <th scope="col" className="hidden w-px whitespace-nowrap px-2 py-1 text-right font-semibold text-gray-500 sm:table-cell dark:text-gray-400">
                    Difficulty
                  </th>
                  <th scope="col" className="w-px px-2 py-1">
                    <span className="sr-only">Source</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {titles.map((title) => (
                  <tr key={title.vn_id}>
                    <th scope="row" className="w-full max-w-0 px-2 py-1 font-normal">
                      <Link
                        href={title.href}
                        className="block truncate text-gray-600 hover:text-primary-600 dark:text-gray-300 dark:hover:text-primary-400"
                      >
                        {getDisplayTitle(
                          {
                            title: title.title,
                            title_jp: title.title_jp ?? undefined,
                            title_romaji: title.title_romaji ?? undefined,
                          },
                          preference,
                        )}
                      </Link>
                    </th>
                    <td className="w-px whitespace-nowrap px-2 py-1 text-right text-gray-500 dark:text-gray-400">
                      {title.characters.toLocaleString()}
                    </td>
                    <td className="hidden w-px whitespace-nowrap px-2 py-1 text-right text-gray-500 sm:table-cell dark:text-gray-400">
                      {title.difficulty === null ? '' : title.difficulty.toFixed(2)}
                    </td>
                    <td className="w-px px-2 py-1">
                      <a
                        href={title.source_href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-primary-600 dark:text-gray-500 dark:hover:text-primary-400"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        <span className="sr-only">This title on jiten.moe</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}
