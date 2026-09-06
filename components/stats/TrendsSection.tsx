'use client';

import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { TrendLineChart } from './TrendLineChart';
import { VNTimelineChart } from './VNTimelineChart';
import { MonthlyActivity, VNDBListItem, formatScore } from '@/lib/vndb-stats-api';

interface TrendsSectionProps {
  monthlyActivity: MonthlyActivity[];
  novels: VNDBListItem[];
  isLoading?: boolean;
}

type ChartMode = 'monthly' | 'cumulative';

export function TrendsSection({ monthlyActivity, novels, isLoading }: TrendsSectionProps) {
  const [vnsChartMode, setVnsChartMode] = useState<ChartMode>('cumulative');
  const [hoursChartMode, setHoursChartMode] = useState<ChartMode>('cumulative');
  const [scoreChartMode, setScoreChartMode] = useState<ChartMode>('monthly');

  // Calculate cumulative data
  const cumulativeData = useMemo(() => {
    // Accumulated in a loop rather than inside a map callback: the running totals belong to
    // this one pass, and a callback closing over them outlives it.
    let totalVns = 0;
    let totalHours = 0;
    let totalScoreSum = 0;
    let totalScoredVns = 0;
    const rows = [];

    for (const item of monthlyActivity) {
      totalVns += item.completed;
      totalHours += item.hours;

      // For cumulative average, we weight by completed VNs each month
      if (item.avg_score !== null && item.completed > 0) {
        totalScoreSum += item.avg_score * item.completed;
        totalScoredVns += item.completed;
      }

      rows.push({
        ...item,
        cumulativeVns: totalVns,
        cumulativeHours: totalHours,
        cumulativeAvgScore: totalScoredVns > 0 ? totalScoreSum / totalScoredVns : null,
      });
    }

    return rows;
  }, [monthlyActivity]);

  // Calculate stats for summary
  const stats = useMemo(() => {
    if (monthlyActivity.length === 0) {
      return { activeMonths: 0, dateRange: null, avgPerMonth: 0, peakMonth: null, avgScore: null };
    }

    const totalCompleted = monthlyActivity.reduce((sum, m) => sum + m.completed, 0);
    const avgPerMonth = totalCompleted / monthlyActivity.length;

    const peakMonth = monthlyActivity.reduce((peak, m) =>
      m.completed > (peak?.completed || 0) ? m : peak
    , monthlyActivity[0]);

    // Use the weighted average from cumulative data (last entry has the overall average)
    const lastCumulativeEntry = cumulativeData[cumulativeData.length - 1];
    const avgScore = lastCumulativeEntry?.cumulativeAvgScore ?? null;

    // Get actual date range (first and last month)
    const sortedMonths = [...monthlyActivity].sort((a, b) => a.month.localeCompare(b.month));
    const firstMonth = sortedMonths[0]?.month;
    const lastMonth = sortedMonths[sortedMonths.length - 1]?.month;

    return {
      activeMonths: monthlyActivity.length,
      dateRange: firstMonth && lastMonth ? { first: firstMonth, last: lastMonth } : null,
      avgPerMonth: Math.round(avgPerMonth * 10) / 10,
      peakMonth,
      // Kept unrounded: the tile shares the summary tab's formatter, which sets the precision.
      avgScore,
    };
  }, [monthlyActivity, cumulativeData]);

  // Format month for display
  const formatMonth = (month: string) => {
    if (!month || month.length < 7) return month;
    const [year, monthNum] = month.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = monthNames[parseInt(monthNum, 10) - 1] || monthNum;
    return `${monthName} '${year.slice(-2)}`;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Loading skeleton */}
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="st-card p-5">
            <div className="h-4 w-48 rounded-xs mb-4 image-placeholder" />
            <div className="h-48 rounded-xs image-placeholder" />
          </div>
        ))}
      </div>
    );
  }

  if (monthlyActivity.length === 0 && novels.length === 0) {
    return (
      <div className="st-card p-8 text-center">
        <h3 className="st-card-title mb-2">No Trend Data Yet</h3>
        <p className="st-card-sub mx-auto max-w-md">
          Trends are calculated from your reading history. Make sure your VNDB list has finish dates set for completed visual novels.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Stats */}
      {stats.activeMonths > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="st-card p-4">
            <span className="fig-label">Date range</span>
            <span className="st-num mt-1.5 block text-sm text-[color:var(--ink)]">
              {stats.dateRange ? `${formatMonth(stats.dateRange.first)} - ${formatMonth(stats.dateRange.last)}` : '-'}
            </span>
            <span className="fig-delta">{stats.activeMonths} months with activity</span>
          </div>
          <div className="st-card p-4">
            <span className="fig-label">Avg per month</span>
            <span className="fig-value">{stats.avgPerMonth}</span>
            <span className="fig-delta">{stats.avgPerMonth === 1 ? 'VN' : 'VNs'}</span>
          </div>
          {stats.peakMonth && (
            <div className="st-card p-4">
              <span className="fig-label">Peak month</span>
              <span className="fig-value">{stats.peakMonth.completed}</span>
              <span className="fig-delta">{formatMonth(stats.peakMonth.month)}</span>
            </div>
          )}
          {stats.avgScore !== null && (
            <div className="st-card p-4">
              <span className="fig-label">Overall avg score</span>
              <span className="fig-value">{formatScore(stats.avgScore)}</span>
            </div>
          )}
        </div>
      )}

      {/* VNs Read Over Time */}
      <TrendLineChart
        data={cumulativeData}
        dataKey={vnsChartMode === 'cumulative' ? 'cumulativeVns' : 'completed'}
        xAxisKey="month"
        title="Visual Novels Read Over Time"
        subtitle="Only includes VNs with a finish date or vote timestamp"
        color="var(--kohaku)"
        areaFill={true}
        formatValue={(v) => `${v}`}
        formatXAxis={formatMonth}
        headerRight={
          <select
            value={vnsChartMode}
            onChange={(e) => setVnsChartMode(e.target.value as ChartMode)}
            className="st-select shrink-0 px-2 py-1 text-xs"
          >
            <option value="cumulative">Cumulative</option>
            <option value="monthly">Monthly</option>
          </select>
        }
      />

      {/* Hours Over Time */}
      <TrendLineChart
        data={cumulativeData}
        dataKey={hoursChartMode === 'cumulative' ? 'cumulativeHours' : 'hours'}
        xAxisKey="month"
        title="Estimated Reading Hours Over Time"
        subtitle="Only includes VNs with a finish date or vote timestamp"
        color="var(--ai)"
        areaFill={true}
        yAxisLabel="hours"
        formatValue={(v) => `${v.toLocaleString()}`}
        formatXAxis={formatMonth}
        headerRight={
          <select
            value={hoursChartMode}
            onChange={(e) => setHoursChartMode(e.target.value as ChartMode)}
            className="st-select shrink-0 px-2 py-1 text-xs"
          >
            <option value="cumulative">Cumulative</option>
            <option value="monthly">Monthly</option>
          </select>
        }
      />

      {/* Average Score Over Time */}
      {monthlyActivity.some(m => m.avg_score !== null) && (
        <TrendLineChart
          data={cumulativeData.filter(m => scoreChartMode === 'cumulative' ? m.cumulativeAvgScore !== null : m.avg_score !== null).map(m => ({
            ...m,
            score: scoreChartMode === 'cumulative' ? m.cumulativeAvgScore! : m.avg_score!,
          }))}
          dataKey="score"
          xAxisKey="month"
          title="Average Score Over Time"
          subtitle="Only includes VNs with a finish date or vote timestamp"
          color="var(--kohaku)"
          areaFill={false}
          formatValue={(v) => v.toFixed(2)}
          formatXAxis={formatMonth}
          headerRight={
            <select
              value={scoreChartMode}
              onChange={(e) => setScoreChartMode(e.target.value as ChartMode)}
              className="st-select shrink-0 px-2 py-1 text-xs"
            >
              <option value="monthly">Monthly</option>
              <option value="cumulative">Cumulative</option>
            </select>
          }
        />
      )}

      {/* Timeline */}
      <VNTimelineChart novels={novels} />

      {/* Info note */}
      <div className="flex items-start gap-2 p-4 bg-[color:var(--surface-inset)] rounded-xs text-xs text-[color:var(--nezu)]">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <p className="mb-1">
            <strong>How trends are calculated:</strong> All charts use finish dates or vote timestamps to place VNs on the timeline.
            VNs without either date are excluded from these charts but still counted in the Summary tab.
          </p>
          <p>
            Reading hours are estimated based on VNDB&apos;s length categories (Very Short = ~1h, Short = ~6h, Medium = ~20h, Long = ~40h, Very Long = ~60h).
          </p>
        </div>
      </div>
    </div>
  );
}
