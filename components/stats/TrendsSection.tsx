'use client';

import { useMemo, useState } from 'react';
import { TrendingUp, BookOpen, Clock, Star, Info } from 'lucide-react';
import { TrendLineChart } from './TrendLineChart';
import { VNTimelineChart } from './VNTimelineChart';
import { MonthlyActivity, VNDBListItem } from '@/lib/vndb-stats-api';

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
    let totalVns = 0;
    let totalHours = 0;
    let totalScoreSum = 0;
    let totalScoredVns = 0;

    return monthlyActivity.map((item) => {
      totalVns += item.completed;
      totalHours += item.hours;

      // For cumulative average, we weight by completed VNs each month
      if (item.avg_score !== null && item.completed > 0) {
        totalScoreSum += item.avg_score * item.completed;
        totalScoredVns += item.completed;
      }

      return {
        ...item,
        cumulativeVns: totalVns,
        cumulativeHours: totalHours,
        cumulativeAvgScore: totalScoredVns > 0 ? totalScoreSum / totalScoredVns : null,
      };
    });
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
      avgScore: avgScore !== null ? Math.round(avgScore * 10) / 10 : null,
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
          <div key={i} className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
            <div className="h-4 w-48 rounded mb-4 image-placeholder" />
            <div className="h-48 rounded image-placeholder" />
          </div>
        ))}
      </div>
    );
  }

  if (monthlyActivity.length === 0 && novels.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none text-center">
        <TrendingUp className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Trend Data Yet</h3>
        <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
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
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Date Range</div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {stats.dateRange ? `${formatMonth(stats.dateRange.first)} - ${formatMonth(stats.dateRange.last)}` : '-'}
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {stats.activeMonths} months with activity
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Avg per Month</div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {stats.avgPerMonth} VNs
            </div>
          </div>
          {stats.peakMonth && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Peak Month</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {stats.peakMonth.completed} <span className="text-sm font-normal text-gray-500">({formatMonth(stats.peakMonth.month)})</span>
              </div>
            </div>
          )}
          {stats.avgScore !== null && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Overall Avg Score</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-1">
                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                {stats.avgScore}
              </div>
            </div>
          )}
        </div>
      )}

      {/* VNs Read Over Time */}
      <div className="relative">
        <div className="absolute right-5 top-5 z-10">
          <select
            value={vnsChartMode}
            onChange={(e) => setVnsChartMode(e.target.value as ChartMode)}
            className="text-xs bg-gray-100 dark:bg-gray-700 border-0 rounded-md px-2 py-1 text-gray-600 dark:text-gray-300 focus:ring-2 focus:ring-primary-500"
          >
            <option value="cumulative">Cumulative</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <TrendLineChart
          data={cumulativeData}
          dataKey={vnsChartMode === 'cumulative' ? 'cumulativeVns' : 'completed'}
          xAxisKey="month"
          title="Visual Novels Read Over Time"
          subtitle="Based on finish dates or vote timestamps"
          color="#8b5cf6"
          areaFill={true}
          formatValue={(v) => `${v}`}
          formatXAxis={formatMonth}
        />
      </div>

      {/* Hours Over Time */}
      <div className="relative">
        <div className="absolute right-5 top-5 z-10">
          <select
            value={hoursChartMode}
            onChange={(e) => setHoursChartMode(e.target.value as ChartMode)}
            className="text-xs bg-gray-100 dark:bg-gray-700 border-0 rounded-md px-2 py-1 text-gray-600 dark:text-gray-300 focus:ring-2 focus:ring-primary-500"
          >
            <option value="cumulative">Cumulative</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <TrendLineChart
          data={cumulativeData}
          dataKey={hoursChartMode === 'cumulative' ? 'cumulativeHours' : 'hours'}
          xAxisKey="month"
          title="Estimated Reading Hours Over Time"
          subtitle="Based on finish dates or vote timestamps"
          color="#06b6d4"
          areaFill={true}
          yAxisLabel="hours"
          formatValue={(v) => `${v.toLocaleString()}`}
          formatXAxis={formatMonth}
        />
      </div>

      {/* Average Score Over Time */}
      {monthlyActivity.some(m => m.avg_score !== null) && (
        <div className="relative">
          <div className="absolute right-5 top-5 z-10">
            <select
              value={scoreChartMode}
              onChange={(e) => setScoreChartMode(e.target.value as ChartMode)}
              className="text-xs bg-gray-100 dark:bg-gray-700 border-0 rounded-md px-2 py-1 text-gray-600 dark:text-gray-300 focus:ring-2 focus:ring-primary-500"
            >
              <option value="monthly">Monthly</option>
              <option value="cumulative">Cumulative</option>
            </select>
          </div>
          <TrendLineChart
            data={cumulativeData.filter(m => scoreChartMode === 'cumulative' ? m.cumulativeAvgScore !== null : m.avg_score !== null).map(m => ({
              ...m,
              score: scoreChartMode === 'cumulative' ? m.cumulativeAvgScore! : m.avg_score!,
            }))}
            dataKey="score"
            xAxisKey="month"
            title="Average Score Over Time"
            subtitle="Based on finish dates or vote timestamps"
            color="#f59e0b"
            areaFill={false}
            formatValue={(v) => v.toFixed(2)}
            formatXAxis={formatMonth}
          />
        </div>
      )}

      {/* Timeline */}
      <VNTimelineChart novels={novels} />

      {/* Info note */}
      <div className="flex items-start gap-2 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-xs text-gray-500 dark:text-gray-400">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <p className="mb-1">
            <strong>How trends are calculated:</strong> The reading timeline requires start and/or finish dates.
            The other charts (VNs, Hours, Score) are based on finish dates you've set on VNDB.
          </p>
          <p>
            Reading hours are estimated based on VNDB's length categories (Very Short = ~1h, Short = ~6h, Medium = ~20h, Long = ~40h, Very Long = ~60h).
          </p>
        </div>
      </div>
    </div>
  );
}
