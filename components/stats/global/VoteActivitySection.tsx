'use client';

import { useEffect, useMemo, useState } from 'react';

import { ChartFrame } from '@/components/charts/ChartFrame';
import { LineChart } from '@/components/charts/LineChart';
import { SimpleBarChart } from '@/components/charts/SimpleBarChart';
import { cumulative } from '@/lib/chart-scales';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { GlobalVoteActivity } from '@/lib/vndb-stats-api';

/**
 * When the community actually rates things.
 *
 * Distinct from every other chart on this page, which keys on when titles were released.
 * This keys on when people voted, so it describes the readers rather than the medium.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * The two ways to read the same series, and what each one is called.
 *
 * A running total climbs whatever happens, so the two answer different questions: one says
 * how active a year was, the other how much has been rated altogether by the end of it. The
 * title and the line below it both change with the mode, since a chart of one read as the
 * other is the kind of mistake nothing on the page would correct.
 */
type VoteMode = 'yearly' | 'cumulative';

const VOTE_MODES: Record<VoteMode, { option: string; title: string; subtitle: string }> = {
  yearly: {
    option: 'Per year',
    title: 'Votes cast per year',
    subtitle: 'How many votes were cast in each year, counted on its own',
  },
  cumulative: {
    option: 'Running total',
    title: 'Votes cast, running total',
    subtitle: 'Every vote cast up to the end of each year, added together',
  },
};

export function VoteActivitySection() {
  const [activity, setActivity] = useState<GlobalVoteActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<VoteMode>('yearly');

  useEffect(() => {
    vndbStatsApi
      .getGlobalActivity()
      .then(setActivity)
      .finally(() => setLoading(false));
  }, []);

  const yearPoints = useMemo(
    () => (activity?.by_year ?? []).map((row) => ({ x: String(row.year), y: row.count })),
    [activity],
  );

  const cumulativePoints = useMemo(() => {
    const totals = cumulative(yearPoints.map((point) => point.y));
    return yearPoints.map((point, index) => ({ x: point.x, y: totals[index] }));
  }, [yearPoints]);

  const monthBars = useMemo(
    () =>
      (activity?.by_month ?? []).map((row) => ({
        key: String(row.month),
        label: MONTHS[row.month - 1],
        value: row.share,
      })),
    [activity],
  );

  const weekdayBars = useMemo(
    () =>
      (activity?.by_weekday ?? []).map((row) => ({
        key: String(row.weekday),
        label: WEEKDAYS[row.weekday],
        value: row.share,
      })),
    [activity],
  );

  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="image-placeholder h-56 rounded-xs lg:col-span-2" />
        <div className="image-placeholder h-52 rounded-xs" />
        <div className="image-placeholder h-52 rounded-xs" />
      </div>
    );
  }

  // Rendering nothing would leave the section heading and its explanation standing over a
  // gap. A stated absence is shorter than the content and still accounts for the heading,
  // but only if it names the right absence: the fetcher returns null when the request failed
  // and an empty payload when the job has not run, and those want different answers.
  if (activity === null) {
    return (
      <p className="st-card-sub italic">
        These could not be loaded. The stats service did not answer, which is usually brief.
      </p>
    );
  }

  if (!activity.by_year.length) {
    return (
      <p className="st-card-sub italic">
        Not available until the nightly rebuild has run.
      </p>
    );
  }

  // The dump is a snapshot mid-year, so its final year is always partial and would read as
  // a collapse in activity if charted alongside complete ones.
  const series = mode === 'yearly' ? yearPoints : cumulativePoints;
  const completeYears = series.slice(0, -1);
  const partialYear = activity.by_year[activity.by_year.length - 1];

  return (
    <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <ChartFrame
        title={VOTE_MODES[mode].title}
        subtitle={VOTE_MODES[mode].subtitle}
        height={200}
        className="lg:col-span-2"
        headerRight={
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as VoteMode)}
            className="rounded-xs border border-[color:var(--rule)] bg-[color:var(--surface)] px-2 py-1 text-xs text-[color:var(--nezu)]"
            aria-label="Vote chart mode"
          >
            {(Object.keys(VOTE_MODES) as VoteMode[]).map((key) => (
              <option key={key} value={key}>
                {VOTE_MODES[key].option}
              </option>
            ))}
          </select>
        }
        footer={
          <p className="text-xs text-[color:var(--text-faint)]">
            {/* The running total stops one year short of the stated total, so the two figures
                are given separately rather than leaving the difference to be noticed. */}
            {mode === 'cumulative' && completeYears.length ? (
              <>
                The line ends at {completeYears[completeYears.length - 1].y.toLocaleString()}{' '}
                votes, everything cast up to the end of{' '}
                {completeYears[completeYears.length - 1].x}.
                {partialYear
                  ? ` A further ${partialYear.count.toLocaleString()} were cast in ${partialYear.year}, which the dump only partly covers.`
                  : null}
              </>
            ) : (
              <>
                {activity.total.toLocaleString()} dated votes in total.{' '}
                {partialYear
                  ? `${partialYear.year} is excluded from the chart: the dump is a snapshot part-way through it.`
                  : null}
              </>
            )}
          </p>
        }
        empty={completeYears.length === 0}
      >
        <LineChart points={completeYears} color="var(--kohaku)" valueSuffix="votes" />
      </ChartFrame>

      <ChartFrame
        title="Is reading seasonal?"
        subtitle="Share of all votes cast in each month of the year, pooled across every year"
        height={190}
      >
        <SimpleBarChart
          data={monthBars}
          formatValue={percent}
          highlightMax
          color="var(--ai)"
          // The shares add up to a whole year, so one twelfth is exactly the average
          // month. Naming it that rather than describing the arithmetic: a reader should be
          // able to see which months are busier without working out what the line is.
          baseline={{ value: 1 / 12, label: 'average month' }}
        />
      </ChartFrame>

      <ChartFrame
        title="Rating by day of the week"
        subtitle="Share of all votes by weekday"
        height={190}
      >
        <SimpleBarChart
          data={weekdayBars}
          formatValue={percent}
          highlightMax
          color="var(--kohaku)"
          baseline={{ value: 1 / 7, label: 'average day' }}
        />
      </ChartFrame>
    </div>
  );
}
