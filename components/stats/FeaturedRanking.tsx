'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/Link';
import { Trophy } from 'lucide-react';

import { PreviewPanel, PreviewRow } from '@/components/stats/PreviewPanel';
import { getDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { Leaderboard } from '@/lib/vndb-stats-api';

/**
 * One board, shown on the stats landing page beside the trends panel.
 *
 * One fixed board rather than a rotating pick. This is a landing page, so the panel is doing
 * an introductory job: it should read the same on a second visit, and the board it shows
 * should be the one whose meaning needs no explaining. A rotation lands on boards whose whole
 * point is that they are unintuitive, which is the wrong first impression.
 *
 * Rendered through the shared preview panel rather than the full leaderboard table. The table
 * belongs on a board page, where medal badges, external links and a hundred rows all earn
 * their space; next to a five-row panel it reads as a different design.
 */

/**
 * The plainest ranking there is: the highest rated titles, Japanese-original by default.
 *
 * Built rather than read from a standing board: a board kept alive purely to feed this panel
 * would put a second URL behind an answer the builder already gives.
 */
const FEATURED_QUESTION = { subject: 'vns', question: 'rated', olang: 'ja' } as const;

/** Where "Full board" goes: the builder, already filled in with what the panel is showing. */
const FEATURED_HREF = '/stats/rankings/build/';

const ROWS_SHOWN = 5;

export function FeaturedRanking() {
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const { preference } = useTitlePreference();

  useEffect(() => {
    let cancelled = false;

    // Japanese-original, matching the default everywhere else in the section.
    vndbStatsApi
      .getCustomRanking({ ...FEATURED_QUESTION, limit: ROWS_SHOWN })
      .then((result) => {
        if (cancelled) return;
        setBoard(result.state === 'ok' ? result.board : null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="h-[26rem] rounded-xl image-placeholder" />;
  }

  if (!board || board.rows.length === 0) return null;

  return (
    <PreviewPanel
      icon={<Trophy className="h-4 w-4 text-amber-500" />}
      title={board.title}
      href={FEATURED_HREF}
      linkLabel="Full ranking"
      // First sentence only. The full explanation earns its length on the ranking itself,
      // where somebody is reading the numbers; here it is a caption on a five-row panel.
      blurb={board.blurb.split('. ')[0] + '.'}
      footer={
        <Link
          href="/stats/rankings/"
          className="text-xs font-medium text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400"
        >
          Browse all {board.total_ranked.toLocaleString()} ranked, and every other ranking
        </Link>
      }
    >
      {board.rows.slice(0, ROWS_SHOWN).map((row) => {
        const name = getDisplayTitle(
          {
            title: row.label,
            title_jp: row.title_jp ?? undefined,
            title_romaji: row.title_romaji ?? undefined,
          },
          preference,
        );
        const average = row.secondary?.average as number | undefined;

        return (
          <PreviewRow
            key={row.id}
            href={row.href ?? `/vn/${row.id.replace(/^v/, '')}`}
            imageUrl={row.image_url}
            imageSexual={row.image_sexual}
            vnId={row.image_vn_id ?? row.id}
            name={name}
            place={row.rank}
            detail={
              average !== undefined
                ? `${average.toFixed(2)} unweighted`
                : 'across every public vote'
            }
            figure={
              <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                {row.value_label}
              </span>
            }
          />
        );
      })}
    </PreviewPanel>
  );
}
