'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Pencil, Clock } from 'lucide-react';

import { ChartFrame } from '@/components/charts/ChartFrame';
import { LineChart } from '@/components/charts/LineChart';
import { cumulative, formatMonthLabel } from '@/lib/chart-scales';
import { LanguageFilter } from '@/components/stats/LanguageFilter';
import type { LanguageFilterValue } from '@/components/stats/LanguageFilter';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { GlobalDatabaseStats } from '@/lib/vndb-stats-api';
import { getDisplayTitle, useTitlePreference } from '@/lib/title-preference';

/**
 * The database as an artefact rather than a source: when entries were catalogued, how much
 * editing they have taken, and which have changed most recently.
 *
 * Distinct from every other chart on the page, which keys on release dates. A 2003 title
 * catalogued in 2019 appears under 2019 here and 2003 elsewhere.
 */

function formatDate(value: string | null): string {
  if (!value) return '';
  // An explicit locale, not the reader's: this sits inside English copy.
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function DatabaseGrowthSection() {
  const [stats, setStats] = useState<GlobalDatabaseStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { preference } = useTitlePreference();
  const [showCumulative, setShowCumulative] = useState(true);
  // Japanese-original by default, as everywhere else here: the site is for people reading
  // Japanese, so that is the view worth opening on, with the whole catalogue one click away.
  const [language, setLanguage] = useState<LanguageFilterValue>('ja');

  useEffect(() => {
    let cancelled = false;
    vndbStatsApi
      .getGlobalDatabase(language)
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const points = useMemo(() => {
    const rows = stats?.growth ?? [];
    const counts = rows.map((row) => row.count);
    const ys = showCumulative ? cumulative(counts) : counts;
    return rows.map((row, i) => ({ x: row.month, y: ys[i] }));
  }, [stats, showCumulative]);

  if (loading) {
    // Shaped like what lands: a filter row, the growth curve, then the two lists beside it.
    // One box of the wrong height moves everything below the section when its data arrives.
    return (
      <div className="space-y-4">
        <div className="image-placeholder h-10 w-64 rounded-lg" />
        <div className="image-placeholder h-64 rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="image-placeholder h-80 rounded-xl" />
          <div className="image-placeholder h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  // Empty until an import has populated the entry metadata columns, which is a real state
  // on a fresh database rather than an error.
  if (!stats || !stats.growth.length) {
    // Rendering nothing would leave the section heading and its explanation standing over a
    // gap. A stated absence is shorter than the content and still accounts for the heading.
    return (
      <p className="text-sm italic text-gray-500 dark:text-gray-400">
        Not available until an import has populated the catalogue dates.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <ChartFrame
        title="How the database grew"
        subtitle="When visual novel entries were added to VNDB, by month catalogued"
        height={220}
        headerRight={
          <select
            value={showCumulative ? 'total' : 'monthly'}
            onChange={(event) => setShowCumulative(event.target.value === 'total')}
            className="text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-1"
            aria-label="Growth chart mode"
          >
            <option value="total">Cumulative</option>
            <option value="monthly">Per month</option>
          </select>
        }
        footer={
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {stats.summary.entries_with_dates.toLocaleString()} entries with a recorded
            creation date
            {stats.summary.first_entry
              ? `, the earliest from ${formatDate(stats.summary.first_entry)}`
              : ''}
            . {stats.summary.total_edits.toLocaleString()} edits in total, averaging{' '}
            {stats.summary.mean_edits} per entry.
          </p>
        }
      >
        <LineChart
          points={points}
          color="#10b981"
          formatX={formatMonthLabel}
          valueSuffix="entries"
        />
      </ChartFrame>

      {/* Scoped to the two lists below rather than the section: the growth curve above
          counts every entry ever catalogued, which the filter would misrepresent. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <LanguageFilter value={language} onChange={setLanguage} />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {language === 'ja'
            ? 'The two lists below cover titles originally written in Japanese.'
            : 'The two lists below cover titles in any original language.'}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          <h3 className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white mb-1">
            <Pencil className="w-4 h-4 text-gray-400" />
            Most edited entries
          </h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
            Usually the largest series, the most argued over, or both
          </p>
          <ol className="space-y-1.5">
            {stats.most_edited.slice(0, 10).map((entry, i) => (
              <li key={entry.id} className="flex items-center gap-2 text-sm">
                <span className="w-5 shrink-0 text-xs text-gray-400 tabular-nums">
                  {i + 1}
                </span>
                <Link
                  href={`/vn/${entry.id.replace('v', '')}`}
                  className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400"
                >
                  {getDisplayTitle(
                    {
                      title: entry.title,
                      title_jp: entry.title_jp ?? undefined,
                      title_romaji: entry.title_romaji ?? undefined,
                    },
                    preference,
                  )}
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                  {entry.edits.toLocaleString()} edits
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          <h3 className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white mb-1">
            <Clock className="w-4 h-4 text-gray-400" />
            Recently updated
          </h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
            Entries edited most recently in the latest dump
          </p>
          <ol className="space-y-1.5">
            {stats.recently_updated.slice(0, 10).map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 text-sm">
                <Link
                  href={`/vn/${entry.id.replace('v', '')}`}
                  className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400"
                >
                  {getDisplayTitle(
                    {
                      title: entry.title,
                      title_jp: entry.title_jp ?? undefined,
                      title_romaji: entry.title_romaji ?? undefined,
                    },
                    preference,
                  )}
                </Link>
                <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                  {formatDate(entry.last_edited)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
