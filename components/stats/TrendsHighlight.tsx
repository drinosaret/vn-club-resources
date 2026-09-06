'use client';

import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

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
    return <div className="h-[26rem] rounded-xs image-placeholder" />;
  }

  // Absent while the nightly job rebuilds. The page reads fine without it.
  if (!movers || movers.length === 0) return null;

  return (
    <PreviewPanel
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
                  <span className="st-num inline-flex items-center gap-0.5 text-[11px] text-[color:var(--ink)]">
                    <ArrowUp className="h-3 w-3 text-[color:var(--kohaku)]" aria-hidden="true" />
                    {climbed}
                  </span>
                ) : (
                  // Set inline because the label primitive carries its own colour, which a
                  // utility class cannot outrank. The accent is the one the climb arrow uses,
                  // in the step of the ramp that stays readable as text on both grounds.
                  <span className="fig-label" style={{ color: 'var(--kohaku-text)' }}>
                    new
                  </span>
                )}
                <span className="st-num mt-0.5 block text-[11px] text-[color:var(--text-faint)]">
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
