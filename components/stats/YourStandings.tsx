'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/Link';

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

/** A podium place is filled; everything below it keeps the plain outlined mark. */
function rankClasses(rank: number): string {
  return rank <= 3 ? 'st-badge st-badge--top' : 'st-badge';
}

function StandingRow({ standing }: { standing: LeaderboardStanding }) {
  return (
    <li>
      <Link
        href={`/stats/rankings/${standing.slug}/`}
        className="dg-row st-mid group"
      >
        <span className={`shrink-0 ${rankClasses(standing.rank)}`}>
          #{standing.rank.toLocaleString()}
        </span>
        <span className="dg-name">{standing.title}</span>
        <span className="dg-num">of {standing.total_ranked.toLocaleString()}</span>
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
    <div className="st-card p-5">
      <h2 className="st-card-title mb-1">Where you rank</h2>
      <p className="st-card-sub mb-3">
        {data.standings.length === 1
          ? 'You place on one community leaderboard.'
          : `You place on ${data.standings.length} community leaderboards, best at #${best.rank.toLocaleString()}.`}
      </p>

      <ul>
        {shown.map((standing) => (
          <StandingRow key={standing.slug} standing={standing} />
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="sec-more"
          >
            {expanded ? 'Show fewer' : `Show all ${data.standings.length.toLocaleString()}`}
          </button>
        ) : null}
        <Link href="/stats/rankings/" className="sec-more">
          Browse all rankings
          <span aria-hidden>&rarr;</span>
        </Link>
      </div>
    </div>
  );
}
