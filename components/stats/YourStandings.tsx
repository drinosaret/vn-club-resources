'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Medal } from 'lucide-react';

import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { LeaderboardStanding, LeaderboardStandings } from '@/lib/vndb-stats-api';

/**
 * Which community leaderboards a reader appears on.
 *
 * The percentile card above answers how a reader compares in aggregate. This answers
 * something more specific: which particular corners of the database they rank
 * in. Someone unremarkable overall is often high on a niche board.
 *
 * Boards the reader falls outside of are absent from the response, so an empty list here
 * means genuinely no placements rather than a failure.
 */

interface YourStandingsProps {
  uid: string;
}

/** Medal colouring for podium places; everything else stays plain. */
function rankClasses(rank: number): string {
  if (rank === 1) return 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200';
  if (rank <= 3) return 'bg-gray-200 text-gray-700 dark:bg-gray-600/40 dark:text-gray-200';
  if (rank <= 100) return 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300';
  return 'bg-gray-100 text-gray-500 dark:bg-gray-700/50 dark:text-gray-400';
}

function StandingRow({ standing }: { standing: LeaderboardStanding }) {
  return (
    <li>
      <Link
        href={`/stats/rankings/${standing.slug}/`}
        className="flex items-center gap-3 px-2 py-1.5 -mx-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
      >
        <span
          className={`shrink-0 px-2 py-0.5 rounded-md text-xs font-bold tabular-nums ${rankClasses(standing.rank)}`}
        >
          #{standing.rank.toLocaleString()}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
          {standing.title}
        </span>
        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500 tabular-nums">
          of {standing.total_ranked.toLocaleString()}
        </span>
      </Link>
    </li>
  );
}

/**
 * Placements shown before the list has to earn more room.
 *
 * Enough to see the shape of where somebody ranks without the card running past its
 * neighbours. The rest are one click away rather than absent: the heading counts every
 * placement, so a list that stopped short with no way to continue would be quoting a
 * number it then refused to show.
 */
const SHOWN_BY_DEFAULT = 8;

export function YourStandings({ uid }: YourStandingsProps) {
  const [data, setData] = useState<LeaderboardStandings | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    vndbStatsApi.getLeaderboardStandings(uid).then((result) => {
      if (cancelled) return;
      setData(result);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (loading || !data || data.standings.length === 0) return null;

  const best = data.standings[0];
  const hidden = data.standings.length - SHOWN_BY_DEFAULT;
  const shown = expanded ? data.standings : data.standings.slice(0, SHOWN_BY_DEFAULT);

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white mb-1">
        <Medal className="w-4 h-4 text-gray-400" />
        Where you rank
      </h2>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
        {data.standings.length === 1
          ? 'You place on one community leaderboard.'
          : `You place on ${data.standings.length} community leaderboards, best at #${best.rank.toLocaleString()}.`}
      </p>

      <ul className="space-y-0.5">
        {shown.map((standing) => (
          <StandingRow key={standing.slug} standing={standing} />
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
          >
            {expanded ? 'Show fewer' : `Show all ${data.standings.length.toLocaleString()}`}
          </button>
        ) : null}
        <Link
          href="/stats/rankings/"
          className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
        >
          Browse all rankings
        </Link>
      </div>
    </div>
  );
}
