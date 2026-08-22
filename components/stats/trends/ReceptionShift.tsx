'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TrendingDown, TrendingUp } from 'lucide-react';

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
        className="group flex items-center gap-3 rounded-lg p-1.5 -m-0.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
      >
        <span className="relative w-8 h-11 shrink-0 overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
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
          <span className="block truncate text-sm font-medium text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
            {name}
          </span>
          <span className="block text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {entry.baseline !== undefined && entry.current_score !== undefined
              ? `${entry.baseline.toFixed(2)} to ${entry.current_score.toFixed(2)}, from ${entry.window_votes.toLocaleString()} votes`
              : `across ${entry.window_votes.toLocaleString()} votes`}
          </span>
        </span>

        <span
          className={`shrink-0 text-sm font-semibold tabular-nums ${
            rising
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-rose-600 dark:text-rose-400'
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
    <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/80 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-gray-200/60 dark:border-gray-700/80">
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400 max-w-xl">
          {chosen.caption}
        </p>
        <div
          role="tablist"
          aria-label="Window"
          className="flex flex-wrap shrink-0 rounded-lg bg-gray-100 dark:bg-gray-900/50 p-0.5"
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
                className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  selected
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {window.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-200/60 dark:divide-gray-700/80">
        <section className="min-w-0 p-4 sm:p-5">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white mb-3">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            Rated higher than usual
          </h3>
          {period.rising.length ? (
            <ol className="space-y-0.5">
              {period.rising.map((entry) => (
                <ShiftRow key={entry.id} entry={entry} rising />
              ))}
            </ol>
          ) : (
            <p className="text-sm italic text-gray-500 dark:text-gray-400">
              Nothing moved up clearly in this window.
            </p>
          )}
        </section>

        <section className="min-w-0 p-4 sm:p-5">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white mb-3">
            <TrendingDown className="w-4 h-4 text-rose-500" />
            Rated lower than usual
          </h3>
          {period.falling.length ? (
            <ol className="space-y-0.5">
              {period.falling.map((entry) => (
                <ShiftRow key={entry.id} entry={entry} rising={false} />
              ))}
            </ol>
          ) : (
            <p className="text-sm italic text-gray-500 dark:text-gray-400">
              Nothing moved down clearly in this window.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
