'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from '@/components/Link';
import { ArrowDown, ArrowUp, Minus, Sparkles } from 'lucide-react';

import { NSFWImage } from '@/components/NSFWImage';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { getDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import type { TitlePreference } from '@/lib/title-preference';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { HotNow as HotNowData, HotPeriod, HotTitle } from '@/lib/vndb-stats-api';
import type { LanguageFilterValue } from '@/components/stats/LanguageFilter';
import { TrendsUnavailable } from './TrendsUnavailable';

/**
 * What is happening now, as a standings board rather than a ranking.
 *
 * The distinction this page rests on: a ranking states where something stands, and this
 * states which way it is going. Every row therefore carries its previous position and its
 * previous count, because the movement is the content. A list of the same perennial titles
 * in the same order every week is not news, and that is exactly what the counts alone give.
 *
 * Two lenses per period. The left is what was read most, where the interesting column is the
 * change in place rather than the total. The right is what climbed furthest against its own
 * previous window, which is where a release or a burst of attention actually surfaces.
 */

const PERIOD_LABELS: Record<string, { label: string; window: string; span: string }> = {
  week: { label: 'Week', window: 'the seven days before', span: 'seven days' },
  month: { label: 'Month', window: 'the thirty days before', span: 'thirty days' },
  year: { label: 'Year', window: 'the year before', span: 'year' },
};

function displayName(entry: HotTitle, preference: TitlePreference): string {
  return getDisplayTitle(
    {
      title: entry.title,
      title_jp: entry.title_jp ?? undefined,
      title_romaji: entry.title_romaji ?? undefined,
    },
    preference,
  );
}

/**
 * The change in place, as a reader would read it.
 *
 * A title with no previous place drew no votes at all last window, which is a different
 * statement from having placed badly, so it is marked rather than given a number.
 */
function PlaceChange({ entry }: { entry: HotTitle }) {
  if (entry.previous_place === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 dark:text-violet-400">
        <Sparkles className="w-3 h-3" />
        new
      </span>
    );
  }

  if (entry.place === null) return null;

  const moved = entry.previous_place - entry.place;

  if (moved === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
        <Minus className="w-3 h-3" />
        held
      </span>
    );
  }

  const climbing = moved > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${
        climbing
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-rose-600 dark:text-rose-400'
      }`}
    >
      {climbing ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(moved)}
    </span>
  );
}

interface RowProps {
  entry: HotTitle;
  /** Shows the place badge, which only means something in the most-read list. */
  showPlace: boolean;
}

function HotRow({ entry, showPlace }: RowProps) {
  const { preference } = useTitlePreference();
  const name = displayName(entry, preference);
  const delta = entry.current - entry.previous;

  return (
    <li>
      <Link
        href={entry.href}
        className="group flex items-center gap-3 rounded-lg p-2 -m-0.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
      >
        {showPlace ? (
          <span className="w-5 shrink-0 text-right text-sm font-bold tabular-nums text-gray-500 dark:text-gray-400">
            {entry.place}
          </span>
        ) : null}

        <span className="relative w-9 h-12 shrink-0 overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
          {entry.image_url ? (
            <NSFWImage
              src={getProxiedImageUrl(entry.image_url, 128)}
              alt=""
              vnId={entry.id}
              imageSexual={entry.image_sexual ?? 0}
              className="w-full h-full object-cover"
              compact
            />
          ) : null}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
            {name}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="tabular-nums">{entry.current.toLocaleString()} votes</span>
            {entry.previous > 0 ? (
              <span className="tabular-nums text-gray-500 dark:text-gray-400">
                {delta >= 0 ? '+' : ''}
                {delta.toLocaleString()}
              </span>
            ) : null}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <PlaceChange entry={entry} />
          {entry.lift > 1 && !showPlace ? (
            <span className="mt-0.5 block text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">
              {entry.lift.toFixed(1)}x
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

function PeriodHeadline({ period }: { period: HotPeriod }) {
  const delta = period.votes - period.previous_votes;
  const share = period.previous_votes
    ? Math.round((delta / period.previous_votes) * 100)
    : 0;
  const climbing = delta >= 0;
  const window = PERIOD_LABELS[period.key]?.window ?? 'the period before';

  return (
    <p className="text-sm text-gray-600 dark:text-gray-400">
      <span className="font-semibold text-gray-900 dark:text-white tabular-nums">
        {period.votes.toLocaleString()}
      </span>{' '}
      votes cast,{' '}
      <span
        className={`font-semibold tabular-nums ${
          climbing
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-rose-600 dark:text-rose-400'
        }`}
      >
        {climbing ? 'up' : 'down'} {Math.abs(share)}%
      </span>{' '}
      on {window}.
    </p>
  );
}

export function HotNow({ language }: { language: LanguageFilterValue }) {
  const [data, setData] = useState<HotNowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    vndbStatsApi.getHotNow(language).then((result) => {
      if (cancelled) return;
      setData(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const periods = useMemo(() => data?.periods ?? [], [data]);
  const period = periods.find((p) => p.key === (active ?? periods[0]?.key)) ?? null;

  if (loading) {
    // Sized to the loaded card, so the page does not grow under a reader who scrolls mid-load.
    return <div className="h-[80rem] sm:h-[42rem] rounded-xl image-placeholder" />;
  }

  // Null means the request failed; an empty period would still be an object.
  if (!data) return <TrendsUnavailable what="What is being read now" />;
  // An empty payload rather than a failed request: the nightly job has not written this yet.
  if (!period) return <TrendsUnavailable what="What is being read now" reason="not-built" />;

  return (
    <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/80 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-gray-200/60 dark:border-gray-700/80">
        <PeriodHeadline period={period} />

        <div
          role="tablist"
          aria-label="Period"
          className="flex flex-wrap shrink-0 rounded-lg bg-gray-100 dark:bg-gray-900/50 p-0.5"
        >
          {periods.map((entry) => {
            const selected = entry.key === period.key;
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(entry.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  selected
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {PERIOD_LABELS[entry.key]?.label ?? entry.key}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-200/60 dark:divide-gray-700/80">
        <section className="min-w-0 p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Most read</h2>
          <p className="mt-0.5 mb-3 text-xs text-gray-500 dark:text-gray-400">
            The arrow is the change in place, not in votes.
          </p>
          <ol className="space-y-0.5">
            {period.top.map((entry) => (
              <HotRow key={entry.id} entry={entry} showPlace />
            ))}
          </ol>
        </section>

        <section className="min-w-0 p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Climbing fastest
          </h2>
          <p className="mt-0.5 mb-3 text-xs text-gray-500 dark:text-gray-400">
            Measured against each title&apos;s own previous{' '}
            {PERIOD_LABELS[period.key]?.span ?? `${period.days} days`}, so a steady favourite
            never appears.
          </p>
          {period.movers.length ? (
            <ol className="space-y-0.5">
              {period.movers.map((entry) => (
                <HotRow key={entry.id} entry={entry} showPlace={false} />
              ))}
            </ol>
          ) : (
            <p className="text-sm italic text-gray-500 dark:text-gray-400">
              Nothing rose clearly above its usual rate.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
