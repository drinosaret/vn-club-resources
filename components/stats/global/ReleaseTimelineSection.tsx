'use client';

import { useEffect, useMemo, useState } from 'react';

import { ChartFrame } from '@/components/charts/ChartFrame';
import { LineChart } from '@/components/charts/LineChart';
import { StackedAreaChart } from '@/components/charts/StackedAreaChart';
import type { StackedPoint } from '@/components/charts/StackedAreaChart';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { GlobalTimeline } from '@/lib/vndb-stats-api';
import { PLATFORM_SHORT_LABELS } from '@/lib/platforms';

/**
 * Four views of how the medium changed, all keyed on release year.
 *
 * Loaded separately from the summary above it: these queries are heavier, and a slow trend
 * section should not hold back the numbers people came for.
 */

const LANGUAGE_LABELS: Record<string, string> = {
  ja: 'Japanese',
  en: 'English',
  'zh-Hans': 'Chinese (simplified)',
  'zh-Hant': 'Chinese (traditional)',
  ko: 'Korean',
  ru: 'Russian',
  es: 'Spanish',
  de: 'German',
  other: 'Other',
  unknown: 'Unknown',
};

// The chart buckets everything outside its own series into "other", which is not a VNDB
// code, so the shared map is extended rather than replaced.
const PLATFORM_LABELS: Record<string, string> = { ...PLATFORM_SHORT_LABELS, other: 'Other' };

// Ordered so adjacent bands stay distinguishable, with the largest series first.
//
// Grey is reserved for the catch-all below and appears nowhere else: a named series in grey
// reads as part of the leftovers. Hue alone does not carry a list this long, and no ordering
// of twelve makes every pair safe under colour deficiency, so entries that share a hue are
// separated by lightness instead and the legend stays the way a reader resolves the rest.
const PALETTE = [
  '#4f46e5', '#06b6d4', '#f59e0b', '#ec4899',
  '#10b981', '#8b5cf6', '#ef4444', '#4d7c0f',
  '#60a5fa', '#a16207', '#0d9488', '#f97316',
];

function paletteFor(keys: string[]): Record<string, string> {
  const colors: Record<string, string> = {};
  keys.forEach((key, i) => {
    colors[key] = PALETTE[i % PALETTE.length];
  });
  colors.other = '#94a3b8';
  colors.unknown = '#cbd5e1';
  return colors;
}

function toStacked(rows: { year: number }[], keys: string[]): StackedPoint[] {
  return rows.map((row) => {
    const values: Record<string, number> = {};
    for (const key of keys) {
      const value = (row as Record<string, unknown>)[key];
      if (typeof value === 'number') values[key] = value;
    }
    return { x: row.year, values };
  });
}

function ModeToggle({
  normalized,
  onChange,
}: {
  normalized: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <select
      value={normalized ? 'share' : 'count'}
      onChange={(event) => onChange(event.target.value === 'share')}
      className="text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-1"
      aria-label="Chart mode"
    >
      <option value="count">Count</option>
      <option value="share">Share</option>
    </select>
  );
}

/** Drops the final row of a year-keyed series, which the dump only partly covers. */
function dropTrailingYear<T>(rows: T[] | undefined): T[] {
  return (rows ?? []).slice(0, -1);
}

export function ReleaseTimelineSection() {
  const [timeline, setTimeline] = useState<GlobalTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [languageShare, setLanguageShare] = useState(false);
  const [platformShare, setPlatformShare] = useState(true);

  useEffect(() => {
    vndbStatsApi
      .getGlobalTimeline()
      // The dump is a snapshot part-way through its most recent year, so that year holds a
      // fraction of the releases the others do. Left in, it draws as a collapse on the
      // stacked charts and a spike on the median-length line rather than as a partial count.
      .then((data) =>
        setTimeline(
          data && {
            ...data,
            by_language: dropTrailingYear(data.by_language),
            by_platform: dropTrailingYear(data.by_platform),
            median_length: dropTrailingYear(data.median_length),
            average_rating: dropTrailingYear(data.average_rating),
          },
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const languageKeys = useMemo(
    () => [...(timeline?.languages ?? []), 'other', 'unknown'],
    [timeline],
  );
  const platformKeys = useMemo(
    () => [...(timeline?.platforms ?? []), 'other'],
    [timeline],
  );

  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-80 rounded-xl image-placeholder" />
        ))}
      </div>
    );
  }

  if (!timeline) {
    return (
      <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
        Release trends are unavailable right now.
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartFrame
        title="Releases by original language"
        subtitle="Original language, by release year"
        height={240}
        headerRight={<ModeToggle normalized={languageShare} onChange={setLanguageShare} />}
        empty={!timeline.by_language.length}
      >
        <StackedAreaChart
          points={toStacked(timeline.by_language, languageKeys)}
          series={languageKeys}
          colors={paletteFor(languageKeys)}
          labels={LANGUAGE_LABELS}
          normalized={languageShare}
        />
      </ChartFrame>

      <ChartFrame
        title="Platforms over time"
        subtitle="Platforms released on. A title on several counts once per platform."
        height={240}
        headerRight={<ModeToggle normalized={platformShare} onChange={setPlatformShare} />}
        empty={!timeline.by_platform.length}
      >
        <StackedAreaChart
          points={toStacked(timeline.by_platform, platformKeys)}
          series={platformKeys}
          colors={paletteFor(platformKeys)}
          labels={PLATFORM_LABELS}
          normalized={platformShare}
        />
      </ChartFrame>

      <ChartFrame
        title="Median length by release year"
        subtitle="Median rather than mean: a few enormous outliers would drag the average away from what was typical"
        height={200}
        empty={!timeline.median_length.length}
      >
        <LineChart
          points={timeline.median_length.map((row) => ({
            x: String(row.year),
            y: Math.round((row.median_minutes / 60) * 10) / 10,
          }))}
          color="#06b6d4"
          formatValue={(value) => `${value}h`}
          valueSuffix="median"
        />
      </ChartFrame>

      <ChartFrame
        title="Average rating by release year"
        subtitle="Only titles with at least 10 votes, so a single rating cannot define a year"
        height={200}
        empty={!timeline.average_rating.length}
      >
        <LineChart
          points={timeline.average_rating.map((row) => ({
            x: String(row.year),
            y: row.average,
          }))}
          color="#f59e0b"
          area={false}
          formatValue={(value) => value.toFixed(2)}
        />
      </ChartFrame>
    </div>
  );
}
