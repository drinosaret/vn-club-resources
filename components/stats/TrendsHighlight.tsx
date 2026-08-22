'use client';

import { useEffect, useState } from 'react';
import { ArrowUp, Flame, Sparkles } from 'lucide-react';

import { PreviewPanel, PreviewRow } from '@/components/stats/PreviewPanel';
import { getDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { HotTitle } from '@/lib/vndb-stats-api';

/**
 * The week's climbers, on the stats landing page.
 *
 * Paired with the rankings panel beside it and deliberately answering a different question:
 * that one shows where titles stand, this one shows what changed. Movement is the only thing
 * here worth the space, so the most-read list is left to the trends page and this shows only
 * the climbers.
 */

const ROWS_SHOWN = 5;

export function TrendsHighlight() {
  const [movers, setMovers] = useState<HotTitle[] | null>(null);
  const [loading, setLoading] = useState(true);
  const { preference } = useTitlePreference();

  useEffect(() => {
    let cancelled = false;

    vndbStatsApi.getHotNow().then((data) => {
      if (cancelled) return;
      const periods = data?.periods ?? [];
      const week = periods.find((period) => period.key === 'week') ?? periods[0];
      setMovers(week?.movers ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="h-[26rem] rounded-xl image-placeholder" />;
  }

  // Absent while the nightly job rebuilds. The page reads fine without it.
  if (!movers || movers.length === 0) return null;

  return (
    <PreviewPanel
      icon={<Flame className="h-4 w-4 text-orange-500" />}
      title="Climbing this week"
      href="/stats/trends/"
      linkLabel="All trends"
      blurb="Measured against each title&apos;s own previous seven days, so a steady favourite never appears."
    >
      {movers.slice(0, ROWS_SHOWN).map((entry) => {
        const name = getDisplayTitle(
          {
            title: entry.title,
            title_jp: entry.title_jp ?? undefined,
            title_romaji: entry.title_romaji ?? undefined,
          },
          preference,
        );
        const climbed =
          entry.previous_place !== null && entry.place !== null
            ? entry.previous_place - entry.place
            : null;

        return (
          <PreviewRow
            key={entry.id}
            href={entry.href}
            imageUrl={entry.image_url}
            imageSexual={entry.image_sexual}
            vnId={entry.id}
            name={name}
            detail={`${entry.current.toLocaleString()} votes, up from ${entry.previous.toLocaleString()}`}
            figure={
              <>
                {climbed !== null && climbed > 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    <ArrowUp className="h-3 w-3" />
                    {climbed}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 dark:text-violet-400">
                    <Sparkles className="h-3 w-3" />
                    new
                  </span>
                )}
                <span className="mt-0.5 block text-[11px] font-semibold tabular-nums text-gray-400 dark:text-gray-500">
                  {entry.lift.toFixed(1)}x
                </span>
              </>
            }
          />
        );
      })}
    </PreviewPanel>
  );
}
