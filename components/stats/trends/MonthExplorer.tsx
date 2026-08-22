'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { TitleList } from '@/components/stats/trends/TitleList';
import { TrendsUnavailable } from './TrendsUnavailable';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { MonthExplorer as MonthExplorerData } from '@/lib/vndb-stats-api';
import type { LanguageFilterValue } from '@/components/stats/LanguageFilter';

/**
 * The same month-by-month history the site has always held, finally readable.
 *
 * Served a month at a time rather than as one payload, so moving the scrubber fetches. Every
 * month already seen is kept, which makes going back instant and means a reader sweeping
 * over a range pays only for the months they stop on.
 *
 * The two lenses answer different questions and the second is the reason this exists. The
 * raw count is close to a constant: the same few perennial titles head almost every month
 * for fifteen years. Measuring each title against its own normal rate instead is what
 * surfaces the month something actually happened.
 */

const SHOWN_PER_SIDE = 5;

/** Renders "2020-04" as "April 2020", which is how anyone would say it. */
function monthLabel(month: string): string {
  const [year, index] = month.split('-');
  const name = new Date(Date.UTC(2000, Number(index) - 1, 1)).toLocaleString('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  });
  return `${name} ${year}`;
}

export function MonthExplorer({ language }: { language: LanguageFilterValue }) {
  const [months, setMonths] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [current, setCurrent] = useState<MonthExplorerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Months already fetched, so scrubbing back over them costs nothing. A ref rather than
  // state: filling it must not itself trigger a render.
  const seen = useRef(new Map<string, MonthExplorerData>());

  // What the reader has asked for most recently. Responses arrive out of order when a
  // slower month is still in flight, so each one is checked against this before it is
  // allowed to become what is on screen.
  const wanted = useRef<string | null>(null);

  // Where the scrubber sits, which is not yet where the reader has settled. One drag across
  // the track crosses every month in between, and committing each would queue a request per
  // step; this holds the position so only the month they stop on is ever fetched.
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const load = useCallback(async (month?: string) => {
    wanted.current = month ?? null;

    const cached = month ? seen.current.get(month) : undefined;
    if (cached) {
      setCurrent(cached);
      setFailed(false);
      return;
    }

    const data = await vndbStatsApi.getMonthExplorer(month, language);

    // Keeping the last good month on screen beats replacing a populated panel with nothing,
    // so a failure only marks the state and leaves what is already drawn alone.
    if (!data || !data.month) {
      if (wanted.current === (month ?? null)) setFailed(true);
      return;
    }

    seen.current.set(data.month, data);
    if (data.months.length) setMonths(data.months);

    // A response for a month the reader has already moved off is kept for later but not
    // shown, or the lists would end up describing a different month than the heading.
    if (month !== undefined && wanted.current !== month) return;

    setFailed(false);
    setCurrent(data);
    if (month === undefined) setSelected(data.month);
  }, [language]);

  // A language change invalidates every month already fetched, so the cache is dropped and
  // the panel reloads from the most recent month in the new view.
  useEffect(() => {
    seen.current.clear();
    setSelected(null);
    setScrubbing(null);
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (selected) load(selected);
  }, [selected, load]);

  // Commits the scrubber once it has been still briefly. Cheaper than waiting for pointer-up,
  // and it covers the keyboard case, where there is no pointer to release.
  useEffect(() => {
    if (scrubbing === null) return;
    const month = months[scrubbing];
    if (!month) return;
    const settle = setTimeout(() => {
      setSelected(month);
      // Hand control back to the committed month, so the arrows step from where the reader
      // actually landed rather than from a stale handle position.
      setScrubbing(null);
    }, 180);
    return () => clearTimeout(settle);
  }, [scrubbing, months]);

  if (loading) {
    return <div className="h-[55rem] sm:h-[32rem] rounded-xl image-placeholder" />;
  }

  // Checked before the empty return below, which would otherwise swallow a real outage: the
  // rest of the page reports one, and a section that silently disappears reads as a section
  // that was never there.
  if (failed) return <TrendsUnavailable what="The month explorer" />;
  if (!months.length || !current?.month) {
    return <TrendsUnavailable what="The month explorer" reason="not-built" />;
  }

  const asked = selected ?? current.month;
  // The scrubber leads the committed month while a drag is in progress, so the label and the
  // handle track the reader's finger even though nothing has been fetched yet.
  const index = scrubbing ?? months.indexOf(asked);
  const scrubbedMonth = months[index] ?? asked;
  const step = (delta: number) => {
    const next = months[index + delta];
    if (next) {
      setScrubbing(null);
      setSelected(next);
    }
  };

  // The heading names the month the control sits on rather than the one whose data has
  // arrived. Each month is a separate request, so naming the loaded one would leave the
  // heading a step behind the slider and need a second line saying which month is on its
  // way, changing on every step to carry a fact the reader just supplied. The lists dim while their
  // month is out of date, which says the same thing without any text appearing or leaving.
  const settling = asked !== current.month;

  return (
    <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/80 bg-white dark:bg-gray-800 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={index <= 0}
          aria-label="Previous month"
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 enabled:hover:bg-gray-100 dark:enabled:hover:bg-gray-700 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="text-center">
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
            {monthLabel(scrubbedMonth)}
          </div>
          {/* Withheld while a month is on its way. The note describes the counts that are
              loaded, and the heading has already moved to the month being fetched, so
              leaving it up would attach a caveat about one month to the name of another. */}
          {current.in_progress && !settling ? (
            <p className="mt-0.5 text-xs font-medium text-orange-600 dark:text-orange-400">
              still running, counts cover the days so far
            </p>
          ) : null}
          {/* Only a failure gets a line of its own. A month on its way needs no announcement:
              the heading already names it and the lists below it are visibly out of date. */}
          {settling && failed ? (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
              {monthLabel(asked)} could not be loaded.{' '}
              <button
                type="button"
                onClick={() => load(asked)}
                className="-mx-1 inline-flex min-h-9 items-center rounded px-1 underline hover:text-primary-600 dark:hover:text-primary-400"
              >
                Try again
              </button>
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => step(1)}
          disabled={index >= months.length - 1}
          aria-label="Next month"
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 enabled:hover:bg-gray-100 dark:enabled:hover:bg-gray-700 disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="mt-3">
        <label htmlFor="month-explorer-slider" className="sr-only">
          Month
        </label>
        <input
          id="month-explorer-slider"
          type="range"
          min={0}
          max={months.length - 1}
          step={1}
          value={index < 0 ? months.length - 1 : index}
          aria-valuetext={monthLabel(months[index < 0 ? months.length - 1 : index] ?? current.month)}
          onChange={(event) => setScrubbing(Number(event.target.value))}
          className="w-full accent-primary-600 cursor-pointer"
        />
        <div className="flex justify-between text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
          <span>{monthLabel(months[0])}</span>
          <span>{monthLabel(months[months.length - 1])}</span>
        </div>
      </div>

      <div
        className={`mt-6 grid gap-6 sm:grid-cols-2 [&>*]:min-w-0 transition-opacity ${
          settling && !failed ? 'opacity-50' : ''
        }`}
        aria-busy={settling && !failed}
      >
        <TitleList
          heading="Most read"
          note="The titles collecting the most votes that month."
          titles={current.read}
          emptyNote="No votes recorded this month."
          limit={SHOWN_PER_SIDE}
        />
        <TitleList
          heading="Biggest jump"
          note="Read far above their own normal rate, so a steady favourite never appears here."
          titles={current.jumped}
          emptyNote="Nothing rose clearly above its usual rate this month."
          limit={SHOWN_PER_SIDE}
        />
      </div>
    </div>
  );
}
