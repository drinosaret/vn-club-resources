'use client';

import { useEffect, useMemo, useState } from 'react';

import { ChartFrame } from '@/components/charts/ChartFrame';
import { LineChart } from '@/components/charts/LineChart';
import { StackedAreaChart } from '@/components/charts/StackedAreaChart';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { ReadingTrends } from '@/lib/vndb-stats-api';

/**
 * How the community's reading has moved through the medium's history.
 *
 * Deliberately not another view of the release timeline. That chart answers what was
 * published in a given year; these answer what was being read in one. The two diverge:
 * readership can drift back through the catalogue while releases move on.
 */

const ERA_LABELS: Record<string, string> = {
  pre2000: 'Before 2000',
  '2000s': '2000s',
  '2010s': '2010s',
  '2020s': '2020s',
};

// Oldest era darkest, so the eye reads the stack as depth into the past.
const ERA_COLORS: Record<string, string> = {
  pre2000: '#7c3aed',
  '2000s': '#2563eb',
  '2010s': '#0891b2',
  '2020s': '#10b981',
};

export function ReadingTrendsSection() {
  const [trends, setTrends] = useState<ReadingTrends | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    vndbStatsApi
      .getReadingTrends()
      .then(setTrends)
      .finally(() => setLoading(false));
  }, []);

  // The dump is a snapshot part-way through its final year, so that year holds a fraction
  // of the votes the others do and would read as a collapse rather than as a partial count.
  const years = useMemo(() => (trends?.years ?? []).slice(0, -1), [trends]);

  const agePoints = useMemo(
    () => years.map((y) => ({ x: String(y.year), y: y.mean_age })),
    [years],
  );

  const eraPoints = useMemo(
    () => years.map((y) => ({ x: y.year, values: y.eras })),
    [years],
  );

  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="image-placeholder h-52 rounded-xl" />
        <div className="image-placeholder h-52 rounded-xl" />
      </div>
    );
  }

  // Rendering nothing would leave the section heading and its explanation standing over a
  // gap. A stated absence is shorter than the content and still accounts for the heading,
  // but only if it names the right absence: a request that failed is not a rebuild that has
  // not run yet, and telling a reader to wait for tomorrow is wrong when the answer is to
  // retry in a minute.
  if (trends === null) {
    return (
      <p className="text-sm italic text-gray-500 dark:text-gray-400">
        These could not be loaded. The stats service did not answer, which is usually brief.
      </p>
    );
  }

  if (!years.length) {
    return (
      <p className="text-sm italic text-gray-500 dark:text-gray-400">
        Not available until the nightly rebuild has run.
      </p>
    );
  }

  const first = years[0];
  const last = years[years.length - 1];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartFrame
        title="How far back people are reading"
        subtitle="Average age of a title at the moment someone rates it"
        height={200}
        footer={
          <p className="text-xs text-gray-500 dark:text-gray-400">
            A title was typically {first.mean_age} years old when it was rated in{' '}
            {first.year}, and {last.mean_age} years old by {last.year}. The audience is
            drifting further into the back catalogue, not keeping pace with new releases.
          </p>
        }
      >
        <LineChart
          points={agePoints}
          color="#7c3aed"
          area
          valueSuffix=" yrs"
          formatValue={(v) => `${v.toFixed(1)} yrs`}
        />
      </ChartFrame>

      <ChartFrame
        title="The era people are reading"
        subtitle="Share of each year's votes going to titles from each decade"
        height={200}
        footer={
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Read down a column rather than across: every year totals 100%, so a band growing
            means that decade took a larger share of what was read, not that more was read.
          </p>
        }
      >
        <StackedAreaChart
          points={eraPoints}
          series={trends?.eras ?? []}
          colors={ERA_COLORS}
          labels={ERA_LABELS}
          normalized
        />
      </ChartFrame>

    </div>
  );
}
