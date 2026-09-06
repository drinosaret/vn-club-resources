'use client';

import { useState } from 'react';
import Link from '@/components/Link';

import { NSFWImage } from '@/components/NSFWImage';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { getDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import type { ShiftingPeriod, ShiftingTitle } from '@/lib/vndb-stats-api';

/**
 * Titles whose reception is moving, over a window the reader chooses.
 *
 * Opens on the month, which is the shortest window with a sample worth reading. The week is
 * offered for whatever is happening right now and is noisier by construction; the quarter is
 * steadier.
 *
 * The all-time option measures something different and the caption says so on that tab. The
 * windows compare a title's votes inside the window against its own lifetime average, which
 * moves every night. All time splits the title's whole history in half and compares the
 * halves, which is a fact about how it aged and does not move. Both belong here because
 * "always drifting, or only lately" is the question the windows raise.
 */

const WINDOWS: { key: string; label: string; caption: string }[] = [
  {
    key: 'week',
    label: 'Week',
    caption:
      "Each title's votes over the last seven days against its own lifetime average. A short window, so a handful of votes moves it.",
  },
  {
    key: 'month',
    label: 'Month',
    caption:
      "Each title's votes over the last thirty days against its own lifetime average.",
  },
  {
    key: 'quarter',
    label: '90 days',
    caption:
      "Each title's votes over the last ninety days against its own lifetime average. The steadiest of the three windows.",
  },
  {
    key: 'all',
    label: 'All time',
    caption:
      "A different comparison: the title's whole history split in half, later votes against earlier ones. This describes how it aged rather than what is happening now, so it barely moves.",
  },
];

function ShiftRow({ entry, rising }: { entry: ShiftingTitle; rising: boolean }) {
  const { preference } = useTitlePreference();
  const name = getDisplayTitle(
    {
      title: entry.title,
      title_jp: entry.title_jp ?? undefined,
      title_romaji: entry.title_romaji ?? undefined,
    },
    preference,
  );

  return (
    <li>
      <Link
        href={entry.href}
        className="dg-row st-mid group"
      >
        <span className="relative h-11 w-8 shrink-0 overflow-hidden rounded-xs border border-[color:var(--rule)] bg-[color:var(--surface-inset)]">
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
          <span className="block truncate font-mono text-xs tabular-nums text-[color:var(--text-faint)]">
            {entry.baseline !== undefined && entry.current_score !== undefined
              ? `${entry.baseline.toFixed(2)} to ${entry.current_score.toFixed(2)}, from ${entry.window_votes.toLocaleString()} votes`
              : `across ${entry.window_votes.toLocaleString()} votes`}
          </span>
        </span>

        <span
          className={`st-num shrink-0 text-sm ${
            rising ? 'text-[color:var(--ink)]' : 'text-[color:var(--beni-text)]'
          }`}
        >
          {entry.shift > 0 ? '+' : ''}
          {entry.shift.toFixed(2)}
        </span>
      </Link>
    </li>
  );
}

export function ReceptionShift({ periods }: { periods: Record<string, ShiftingPeriod> }) {
  const available = WINDOWS.filter((w) => periods[w.key]);
  const [active, setActive] = useState('month');

  if (!available.length) return null;

  const chosen = available.find((w) => w.key === active) ?? available[0];
  const period = periods[chosen.key];

  return (
    <div className="st-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-[color:var(--rule)]">
        <p className="st-card-sub max-w-xl">{chosen.caption}</p>
        <div
          role="tablist"
          aria-label="Window"
          className="tabs shrink-0"
        >
          {available.map((window) => {
            const selected = window.key === chosen.key;
            return (
              <button
                key={window.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(window.key)}
                className={`tab ${selected ? 'tab--on' : ''}`}
              >
                {window.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[color:var(--rule)]">
        <section className="min-w-0 p-4 sm:p-5">
          <h3 className="st-card-title mb-3">Rated higher than usual</h3>
          {period.rising.length ? (
            <ol className="space-y-0.5">
              {period.rising.map((entry) => (
                <ShiftRow key={entry.id} entry={entry} rising />
              ))}
            </ol>
          ) : (
            <p className="st-card-sub italic">
              Nothing moved up clearly in this window.
            </p>
          )}
        </section>

        <section className="min-w-0 p-4 sm:p-5">
          <h3 className="st-card-title mb-3">Rated lower than usual</h3>
          {period.falling.length ? (
            <ol className="space-y-0.5">
              {period.falling.map((entry) => (
                <ShiftRow key={entry.id} entry={entry} rising={false} />
              ))}
            </ol>
          ) : (
            <p className="st-card-sub italic">
              Nothing moved down clearly in this window.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
