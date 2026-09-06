'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from '@/components/Link';

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
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--ai)]">
        new
      </span>
    );
  }

  if (entry.place === null) return null;

  const moved = entry.previous_place - entry.place;

  if (moved === 0) {
    return (
      <span className="fig-label">held</span>
    );
  }

  const climbing = moved > 0;
  return (
    <span
      className={`st-num inline-flex items-center gap-0.5 text-[11px] ${
        climbing ? 'text-[color:var(--ink)]' : 'text-[color:var(--beni-text)]'
      }`}
    >
      <span aria-hidden className={climbing ? 'text-[color:var(--kohaku)]' : ''}>
        {climbing ? '▲' : '▼'}
      </span>
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
        className="dg-row st-mid group"
      >
        {showPlace ? (
          <span className="dg-rank">{entry.place}</span>
        ) : null}

        <span className="relative h-12 w-9 shrink-0 overflow-hidden rounded-xs border border-[color:var(--rule)] bg-[color:var(--surface-inset)]">
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
          <span className="dg-name block">
            {name}
          </span>
          <span className="st-num mt-0.5 flex items-center gap-2 text-xs text-[color:var(--text-faint)]">
            <span>{entry.current.toLocaleString()} votes</span>
            {entry.previous > 0 ? (
              <span>
                {delta >= 0 ? '+' : ''}
                {delta.toLocaleString()}
              </span>
            ) : null}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <PlaceChange entry={entry} />
          {entry.lift > 1 && !showPlace ? (
            <span className="st-num mt-0.5 block text-[11px] text-[color:var(--text-faint)]">
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
    <p className="text-sm text-[color:var(--nezu)]">
      <span className="st-num text-[color:var(--ink)]">{period.votes.toLocaleString()}</span>{' '}
      votes cast,{' '}
      <span
        className={`st-num ${climbing ? 'text-[color:var(--ink)]' : 'text-[color:var(--beni-text)]'}`}
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
    return <div className="h-[80rem] sm:h-[42rem] rounded-xs image-placeholder" />;
  }

  // Null means the request failed; an empty period would still be an object.
  if (!data) return <TrendsUnavailable what="What is being read now" />;
  // An empty payload rather than a failed request: the nightly job has not written this yet.
  if (!period) return <TrendsUnavailable what="What is being read now" reason="not-built" />;

  return (
    <div className="st-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-[color:var(--rule)]">
        <PeriodHeadline period={period} />

        <div
          role="tablist"
          aria-label="Period"
          className="tabs shrink-0"
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
                className={`tab ${selected ? 'tab--on' : ''}`}
              >
                {PERIOD_LABELS[entry.key]?.label ?? entry.key}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[color:var(--rule)]">
        <section className="min-w-0 p-4 sm:p-5">
          <h2 className="st-card-title">Most read</h2>
          <p className="st-card-sub mb-3 mt-0.5">
            The arrow is the change in place, not in votes.
          </p>
          <ol className="space-y-0.5">
            {period.top.map((entry) => (
              <HotRow key={entry.id} entry={entry} showPlace />
            ))}
          </ol>
        </section>

        <section className="min-w-0 p-4 sm:p-5">
          <h2 className="st-card-title">
            Climbing fastest
          </h2>
          <p className="st-card-sub mb-3 mt-0.5">
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
            <p className="st-card-sub italic">
              Nothing rose clearly above its usual rate.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
