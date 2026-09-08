'use client';

import { useEffect, useRef, useState } from 'react';
import Link from '@/components/Link';

import { BoardHeader } from '@/components/rankings/BoardHeader';
import { BoardHeaderSkeleton } from '@/components/rankings/BoardHeaderSkeleton';
import { LeaderboardTable } from '@/components/rankings/LeaderboardTable';
import { LanguageFilter } from '@/components/stats/LanguageFilter';
import { StatsCrossLinks } from '@/components/stats/StatsCrossLinks';
import type { LanguageFilterValue } from '@/components/stats/LanguageFilter';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { Leaderboard, LeaderboardResult } from '@/lib/vndb-stats-api';

interface LeaderboardClientProps {
  slug: string;
  /** Falls back to the slug's registry title until the payload arrives. */
  fallbackTitle: string;
  /**
   * The board as the server already fetched it, in the language this opens on.
   *
   * Present, the first paint is the finished table rather than a row of placeholders, and the
   * markup a crawler receives is the ranking rather than an empty shell. Null when the backend
   * could not be reached, which leaves the fetch below to try again from the browser.
   */
  initialBoard: Leaderboard | null;
}

/** The card the rows sit in. Shared with the loading state, which reserves the same box. */
const BOARD_CARD_CLASS = 'st-card p-2';

/**
 * One sentence describing the current state of the board, for a screen reader.
 *
 * The language filter swaps the ranking underneath without moving focus, so a sighted reader
 * sees the table redraw and nobody else is told anything happened. Matches the wording used by
 * the tag rankings, so the two board surfaces speak the same way.
 */
function announcement(
  loading: boolean,
  result: LeaderboardResult | null,
  fallbackTitle: string,
): string {
  if (loading) return `Loading ${fallbackTitle}.`;
  if (result?.state !== 'ok') return `${fallbackTitle} could not be loaded.`;
  const board = result.board;
  const shown = board.rows.length;
  if (!shown) return `${board.title}. Nobody qualifies.`;
  return `${board.title}. Showing ${shown} of ${board.total_ranked.toLocaleString()}.`;
}

export default function LeaderboardClient({
  slug,
  fallbackTitle,
  initialBoard,
}: LeaderboardClientProps) {
  const [result, setResult] = useState<LeaderboardResult | null>(
    initialBoard ? { state: 'ok', board: initialBoard } : null,
  );
  const [loading, setLoading] = useState(!initialBoard);
  // Japanese-original by default: this site is about reading Japanese, so an unfiltered
  // board leads with titles that are beside the point for most readers here.
  const [language, setLanguage] = useState<LanguageFilterValue>('ja');
  // The server fetched the opening language, so the first pass through this effect has
  // nothing to add. Anything after it is a language the reader asked for.
  const served = useRef(initialBoard ? language : null);

  useEffect(() => {
    if (served.current === language) {
      served.current = null;
      return;
    }

    let cancelled = false;
    setLoading(true);

    vndbStatsApi.getLeaderboard(slug, { language }).then((next) => {
      if (cancelled) return;
      setResult(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [slug, language]);

  const board = result?.state === 'ok' ? result.board : null;

  // Board pages all render from one route, but not all of them are listed on the same page.
  // Sending a reader "back" to a page the board does not appear on is a dead end, so the
  // link follows where the board is actually catalogued.
  const onTrends = board?.home === 'trends';
  const parentHref = onTrends ? '/stats/trends/' : '/stats/rankings/';
  const parentLabel = onTrends ? 'All trends' : 'All rankings';

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link
        href={parentHref}
        className="sec-more mb-6 min-h-6 py-1.5"
      >
        <span aria-hidden>&larr;</span>
        {parentLabel}
      </Link>

      <p className="sr-only" role="status">
        {announcement(loading, result, fallbackTitle)}
      </p>

      <div aria-busy={loading}>
        {loading ? (
        <>
          <BoardHeaderSkeleton />
          <div className={BOARD_CARD_CLASS}>
            <div className="space-y-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="h-14 rounded-xs image-placeholder" />
              ))}
            </div>
          </div>
        </>
      ) : !board ? (
        <>
          <h1 className="sec-title mb-3">
            {fallbackTitle}
          </h1>
          {/* Three different absences, each with its own cause. Reporting them the same way
              makes an outage look like routine maintenance. The first covers both a run in
              progress and a board the cache is no longer holding, which the response cannot
              tell apart, so it promises no timeframe it cannot keep. */}
          {result?.state === 'rebuilding' ? (
            <p className="text-[color:var(--nezu)]">
              This ranking is not available right now. Rankings are rebuilt once a day from
              the VNDB dump, so it should return after the next run.
            </p>
          ) : result?.state === 'missing' ? (
            <p className="text-[color:var(--nezu)]">
              This ranking no longer exists.{' '}
              <Link
                href="/stats/rankings/"
                className="underline decoration-dotted underline-offset-2 hover:text-[color:var(--ai)]"
              >
                Browse the current rankings
              </Link>
              .
            </p>
          ) : (
            <p className="text-[color:var(--nezu)]">
              This board is temporarily unreachable. The cause is a connection failure
              rather than a rebuild, so it is worth trying again shortly.
            </p>
          )}
        </>
      ) : (
        <>
          <BoardHeader board={board} />

          {board.has_language_variants ? (
            <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
              <LanguageFilter value={language} onChange={setLanguage} />
              {language === 'ja' ? (
                <p className="st-card-sub">Showing titles originally written in Japanese.</p>
              ) : null}
            </div>
          ) : null}

          <div className={BOARD_CARD_CLASS}>
            <LeaderboardTable rows={board.rows} />
          </div>

          {/* A board runs to a hundred rows, so the back link at the top of the page is a long
              scroll away by the time anyone finishes reading one. Nothing is dropped from this
              list: the section this board belongs to is the likeliest thing wanted next. */}
          <StatsCrossLinks current="none" />
        </>
      )}
      </div>
    </div>
  );
}
