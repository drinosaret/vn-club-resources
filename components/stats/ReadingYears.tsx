'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from '@/components/Link';

import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { ReadingYear } from '@/lib/vndb-stats-api';
import { getDisplayTitle, useTitlePreference } from '@/lib/title-preference';

/**
 * A reader's history, one row per year.
 *
 * Keyed on when each vote was cast rather than when the title came out, which is the whole
 * point: the release-year chart elsewhere on this page says what someone reads, and this says
 * what they were doing. The two look similar and answer different questions.
 *
 * A permanent section with every year rather than a once-a-year summary. The yearly version
 * other sites run is only interesting in December, and this data supports the better version
 * for free.
 */

interface ReadingYearsProps {
  uid: string;
}

export function ReadingYears({ uid }: ReadingYearsProps) {
  const [years, setYears] = useState<ReadingYear[]>([]);
  const [loading, setLoading] = useState(true);
  const { preference } = useTitlePreference();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    vndbStatsApi.getReadingYears(uid).then((result) => {
      if (cancelled) return;
      setYears(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const busiest = useMemo(
    () => years.reduce((best, year) => (year.rated > (best?.rated ?? 0) ? year : best), years[0]),
    [years],
  );
  // Bars are drawn against the busiest year rather than a fixed scale, so a quiet reader's
  // shape is still legible instead of a row of slivers.
  const peak = busiest?.rated ?? 0;

  if (loading) return <div className="image-placeholder h-[26rem] rounded-xs" />;
  // One year is not a history, and a reader whose votes predate VNDB carrying dates has none.
  if (years.length < 2) return null;

  return (
    <div className="flex h-full max-h-[26rem] flex-col st-card p-5">
      <h2 className="st-card-title mb-1">
        Year by year
      </h2>
      <p className="st-card-sub mb-4">
        When you rated things, not when they came out.
        {busiest ? (
          <>
            {' '}
            Your busiest year was {busiest.year}, with {busiest.rated.toLocaleString()} rated.
          </>
        ) : null}
      </p>

      {/* Takes whatever height the row has and scrolls within it. A fixed cap makes the
          card taller than its neighbour for a long history and shorter for a brief one.
          The right padding clears the scrollbar: the counts are right-aligned, so without
          it they sit against the track. The gutter is reserved whether or not the list
          currently overflows, so rows do not shift as it grows. */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden pr-3 [scrollbar-gutter:stable]">
        {years.map((year) => (
          <div key={year.year} className="flex items-baseline gap-3">
            <span className="w-10 shrink-0 text-xs font-medium st-num text-[color:var(--text-secondary)]">
              {year.year}
            </span>

            <span className="flex w-full min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2">
                {/* The bar is drawn inside a track that stops where the count begins, so a
                    full-length bar cannot push the count out of the card. Sizing the bar
                    against the whole row instead leaves the busiest year, the one worth
                    reading, as the only row with no number on it.

                    The track is drawn as well as measured against. Bars here are shares of
                    the busiest year rather than of anything absolute, and without the track
                    there is nothing on screen saying what a full one would be. It also
                    matches the card beside this one, which these bars sit level with. */}
                <span className="st-bar block h-2 min-w-0 flex-1">
                  <span
                    className="st-bar-fill block"
                    style={{ width: `${peak ? Math.max((year.rated / peak) * 100, 2) : 2}%` }}
                    aria-hidden="true"
                  />
                </span>
                <span className="shrink-0 text-xs st-num text-[color:var(--nezu)]">
                  {year.rated.toLocaleString()}
                  {year.average !== null ? (
                    <span className="text-[color:var(--text-faint)]">
                      {' '}
                      &middot; avg {year.average.toFixed(2)}
                    </span>
                  ) : null}
                </span>
              </span>

              {year.best ? (
                <Link
                  href={year.best.href}
                  className="block truncate text-xs text-[color:var(--nezu)] transition-colors hover:text-[color:var(--ai)]"
                >
                  Best that year:{' '}
                  {getDisplayTitle(
                    {
                      title: year.best.title,
                      title_jp: year.best.title_jp ?? undefined,
                      title_romaji: year.best.title_romaji ?? undefined,
                    },
                    preference,
                  )}{' '}
                  ({year.best.score.toFixed(1)})
                </Link>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
