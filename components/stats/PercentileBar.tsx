'use client';

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';

import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { UserPercentiles } from '@/lib/vndb-stats-api';

/**
 * Where a reader sits against everyone else with a public list.
 *
 * A raw total means little on its own: whether 120 finished titles is a lot depends
 * entirely on what everyone else has. This turns the numbers already on the page into that
 * comparison, using nightly sketches of the population rather than a live count across
 * every reader.
 */

interface PercentileBarProps {
  uid: string;
  votes: number;
  finished: number;
  dropped: number;
  wishlist: number;
  average: number | null;
}

/** Singular and plural, because a reader with one dropped title is a real case. */
const LABELS: Record<string, [string, string]> = {
  votes: ['title rated', 'titles rated'],
  finished: ['title finished', 'titles finished'],
  dropped: ['title given up on', 'titles given up on'],
  wishlist: ['title wishlisted', 'titles wishlisted'],
  average: ['average rating', 'average rating'],
};

/** The rating is a score out of ten; everything else is a count of titles. */
function formatValue(key: string, value: number): string {
  return key === 'average' ? value.toFixed(2) : value.toLocaleString();
}

function labelFor(key: string, value: number): string {
  const pair = LABELS[key];
  if (!pair) return key;
  return value === 1 ? pair[0] : pair[1];
}

/**
 * How a standing reads, which depends on what the figure is and on how many share it.
 *
 * "Top 1%" and "ahead of" carry a verdict, and that verdict is only true where more of
 * something is plainly more. On the two measures where it is not, the phrasing states the
 * direction instead: dropping more than most readers is not being ahead of them, and rating
 * lower than most is a description of a scale, not a placing.
 *
 * The figure a reader holds is often the floor of its distribution, and these floors are
 * crowded: most readers have given nothing up. The share at or below such a figure counts
 * everybody standing on the same spot, so quoting it as "more than" claims a lead over a
 * crowd the reader is standing in. Where nobody is below, the tie is the fact worth
 * reporting; everywhere else "more than" is measured against the share strictly below.
 */
function phrase(key: string, percentile: number, below: number): string {
  const round = (value: number) => Math.round(value);
  // The share strictly above, which is what "fewer than" and "lower than" describe.
  const above = 100 - percentile;
  const atFloor = below <= 0.5;
  const atTop = percentile >= 99.5;

  if (atFloor) {
    const shared = round(percentile);
    if (shared <= 1) return 'nobody has fewer';
    if (shared >= 100) return 'same as everyone';
    return `same as ${shared}%`;
  }

  if (key === 'dropped') {
    if (atTop) return 'more than anyone';
    return below >= 50 ? `more than ${round(below)}%` : `fewer than ${round(above)}%`;
  }

  if (key === 'average') {
    if (atTop) return 'higher than almost anyone';
    return below >= 50 ? `higher than ${round(below)}%` : `lower than ${round(above)}%`;
  }

  if (atTop) return 'top 1%';
  if (percentile >= 90) return `top ${Math.max(1, round(above))}%`;
  return `more than ${round(below)}%`;
}

export function PercentileBar({
  uid,
  votes,
  finished,
  dropped,
  wishlist,
  average,
}: PercentileBarProps) {
  const [data, setData] = useState<UserPercentiles | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!votes && !finished && !dropped && !wishlist && !average) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    vndbStatsApi
      .getUserPercentiles(uid, { votes, finished, dropped, wishlist, average: average ?? 0 })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uid, votes, finished, dropped, wishlist, average]);

  const entries = Object.entries(data?.percentiles ?? {});
  // Holding the space while the standings are fetched. Rendering nothing and then a full card
  // moves everything below it, which on this page is most of the page.
  if (loading) return <div className="image-placeholder h-[26rem] rounded-xl" />;
  if (!entries.length) return null;

  return (
    <div className="flex h-full flex-col rounded-xl bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white mb-1">
        <Users className="w-4 h-4 text-gray-400" />
        How you compare
      </h2>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        Against every VNDB user with a public list
      </p>

      {/* Spread rather than stacked: the row is as tall as the taller card, and five
          bars bunched at the top under a band of nothing reads as a card that failed
          to load the rest. */}
      <div className="flex flex-1 flex-col justify-between gap-3">
        {entries.map(([key, entry]) => (
          <div key={key}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {formatValue(key, entry.value)} {labelFor(key, entry.value)}
              </span>
              <span className="text-sm font-semibold text-primary-600 dark:text-primary-400 tabular-nums">
                {phrase(key, entry.percentile, entry.below ?? entry.percentile)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
              {/* Drawn to the figure the row states, whatever that figure means. The share
                  at or below is a standing on most rows and the size of a tie on the rest,
                  and the wording beside the bar is what separates the two. A bar drawn to
                  anything else, however defensible on its own, contradicts the number
                  printed an inch away from it. */}
              <div
                className="h-full rounded-full bg-primary-500"
                style={{ width: `${Math.min(100, Math.max(2, entry.percentile))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
