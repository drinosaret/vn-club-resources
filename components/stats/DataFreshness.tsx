'use client';

import { Database } from 'lucide-react';

/**
 * States which VNDB dump the surrounding page is showing, and when the next one lands.
 *
 * Every number on the stats and rankings pages comes from a dump imported once a day.
 * Anything that reads as a live figure would be claiming a freshness the data does not
 * have, so pages that rank or trend are expected to render this alongside their results.
 */

/** VNDB publishes a dump daily at this hour, UTC. */
const DUMP_HOUR_UTC = 8;
/** The worker imports it a few hours later, also UTC. */
const IMPORT_HOUR_UTC = 4;

export interface DumpInfo {
  date: string;
  ago: string;
}

/**
 * Resolve which dump an import timestamp drew from.
 *
 * Backend timestamps arrive without a zone; parsed as local time they can land on the
 * wrong side of the dump boundary and name yesterday's dump, so an explicit UTC marker is
 * appended when one is missing.
 */
export function getVndbDumpInfo(lastImport: string, now: Date = new Date()): DumpInfo {
  const hasTimezone = /[Zz]$/.test(lastImport) || /[+-]\d{2}:\d{2}$/.test(lastImport);
  const importDate = new Date(hasTimezone ? lastImport : `${lastImport}Z`);

  const dumpDate = new Date(
    Date.UTC(
      importDate.getUTCFullYear(),
      importDate.getUTCMonth(),
      importDate.getUTCDate(),
      DUMP_HOUR_UTC,
      0,
      0,
    ),
  );

  // An import that ran before the dump hour was working from the previous day's file.
  if (importDate < dumpDate) {
    dumpDate.setUTCDate(dumpDate.getUTCDate() - 1);
  }

  // An explicit locale, not the reader's. This string sits inside English copy, and the
  // browser's own locale would set a Japanese or German date in the middle of it.
  const date = `${dumpDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })} at 8:00 UTC`;

  const diffHours = Math.floor((now.getTime() - dumpDate.getTime()) / (1000 * 60 * 60));

  let ago: string;
  if (diffHours < 1) {
    ago = 'just now';
  } else if (diffHours < 24) {
    ago = `${diffHours}h ago`;
  } else {
    const days = Math.floor(diffHours / 24);
    const hours = diffHours % 24;
    ago = hours > 0 ? `${days}d ${hours}h ago` : `${days}d ago`;
  }

  return { date, ago };
}

/** Time until the next scheduled import. */
export function getNextUpdateCountdown(now: Date = new Date()): string {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), IMPORT_HOUR_UTC, 0, 0),
  );
  if (now >= next) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  const minutes = Math.floor((next.getTime() - now.getTime()) / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours < 1) return `in ${minutes}m`;
  return remainder > 0 ? `in ${hours}h ${remainder}m` : `in ${hours}h`;
}

interface DataFreshnessProps {
  /** Import timestamp from /health/db. */
  lastImport?: string | null;
  /** Dump date carried by a leaderboard payload, preferred when present. */
  dumpDate?: string | null;
  vnCount?: number | null;
  className?: string;
}

export function DataFreshness({
  lastImport,
  dumpDate,
  vnCount,
  className = '',
}: DataFreshnessProps) {
  // A board states the dump it was built from directly, which is more precise than
  // inferring it from when the import happened to finish.
  const label = dumpDate
    ? new Date(`${dumpDate}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      })
    : lastImport
      ? getVndbDumpInfo(lastImport).date
      : null;

  // The row keeps its place while the date is on its way. An empty line of the same height
  // costs nothing to look at, where an absent one moves everything below it when it lands.
  if (!label) {
    // Two rows on a phone where the line wraps, one on a desktop where it does not. A single
    // reserved height would hold one breakpoint and shift the other.
    return <p className={`min-h-[38px] sm:min-h-4 ${className}`} aria-hidden="true" />;
  }

  return (
    <p
      className={`flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-500 ${className}`}
    >
      <Database className="w-3.5 h-3.5 shrink-0" />
      <span>VNDB data from {label}</span>
      <span className="text-gray-400 dark:text-gray-600">· updated daily</span>
      <span className="text-gray-400 dark:text-gray-600">
        · next update {getNextUpdateCountdown()}
      </span>
      {vnCount ? (
        <span className="text-gray-400 dark:text-gray-600">
          · {vnCount.toLocaleString()} VNs
        </span>
      ) : null}
    </p>
  );
}
