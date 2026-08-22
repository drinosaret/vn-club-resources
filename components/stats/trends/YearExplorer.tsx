'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { TitleList } from '@/components/stats/trends/TitleList';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { YearExplorer as YearExplorerData } from '@/lib/vndb-stats-api';
import type { LanguageFilterValue } from '@/components/stats/LanguageFilter';
import { TrendsUnavailable } from './TrendsUnavailable';

/**
 * One year at a time, from both sides.
 *
 * The two columns are the reason this exists rather than another chart. What came out in a
 * year and what people were reading in it are different questions, and the years where they
 * disagree are the ones worth looking at: a title can top its release year and never appear
 * on any reading list, while the same handful of older titles hold the reading side for a
 * decade.
 *
 * The reading side is empty for the early years. That is a fact about the record rather than
 * a gap: nobody was logging votes yet, and the panel says so instead of rendering nothing.
 */

export function YearExplorer({ language }: { language: LanguageFilterValue }) {
  const [data, setData] = useState<YearExplorerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    vndbStatsApi.getYearExplorer(language).then((result) => {
      if (cancelled) return;
      setData(result);
      setSelected(null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const years = useMemo(() => data?.years ?? [], [data]);

  // Opens on the most recent complete year rather than the earliest: that is the one most
  // people are looking for, and it is one step from the interesting older years anyway.
  const year = selected ?? (years.length ? years[years.length - 1].year : null);
  const current = years.find((entry) => entry.year === year) ?? null;
  const index = years.findIndex((entry) => entry.year === year);

  if (loading) {
    // Sized to the loaded card, so the page does not grow under a reader who scrolls mid-load.
    return <div className="h-[37rem] sm:h-[32rem] rounded-xl image-placeholder" />;
  }

  if (!data) return <TrendsUnavailable what="The year explorer" />;
  if (!years.length || !current) {
    return <TrendsUnavailable what="The year explorer" reason="not-built" />;
  }

  const step = (delta: number) => {
    const next = years[index + delta];
    if (next) setSelected(next.year);
  };

  const first = years[0].year;
  const last = years[years.length - 1].year;

  return (
    <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/80 bg-white dark:bg-gray-800 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={index <= 0}
          aria-label="Previous year"
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 enabled:hover:bg-gray-100 dark:enabled:hover:bg-gray-700 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="text-center">
          <div className="text-3xl sm:text-4xl font-bold tabular-nums text-gray-900 dark:text-white">
            {current.year}
          </div>
          {current.in_progress ? (
            <p className="mt-0.5 text-xs font-medium text-orange-600 dark:text-orange-400">
              still running, counts cover the year so far
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => step(1)}
          disabled={index >= years.length - 1}
          aria-label="Next year"
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 enabled:hover:bg-gray-100 dark:enabled:hover:bg-gray-700 disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="mt-3">
        <label htmlFor="year-explorer-slider" className="sr-only">
          Year
        </label>
        <input
          id="year-explorer-slider"
          type="range"
          min={first}
          max={last}
          step={1}
          value={current.year}
          onChange={(event) => setSelected(Number(event.target.value))}
          className="w-full accent-primary-600 cursor-pointer"
        />
        <div className="flex justify-between text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
          <span>{first}</span>
          <span>{last}</span>
        </div>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2 [&>*]:min-w-0">
        <TitleList
          heading="Came out that year"
          note="Best rated of the titles first released in this year."
          titles={current.released}
          emptyNote="No title from this year has enough votes to be rated."
        />
        <TitleList
          heading="Being read that year"
          note="Most voted on during this year, whatever year they came out."
          titles={current.read}
          emptyNote="Too few dated votes this early in the record to say."
        />
      </div>
    </div>
  );
}
