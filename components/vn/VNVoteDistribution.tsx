'use client';

import { useMemo } from 'react';
import { ChartHelpTooltip } from '@/components/stats/ChartHelpTooltip';

interface VNVoteDistributionProps {
  distribution: Record<string, number>;
  totalVotes: number;
  publicVotes?: number;
}

export function VNVoteDistribution({ distribution, totalVotes, publicVotes }: VNVoteDistributionProps) {
  const data = useMemo(() => {
    const scores = [];
    for (let i = 1; i <= 10; i++) {
      scores.push({
        score: i,
        count: distribution[String(i)] || 0,
      });
    }
    return scores;
  }, [distribution]);

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  if (totalVotes === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Vote Distribution
        </h3>
        <p className="text-gray-500 dark:text-gray-400">No votes recorded yet</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Vote Distribution
          </h3>
          <ChartHelpTooltip text="VNDB votes are on a 10–100 scale. Each bar groups votes rounded to the nearest 10 (e.g. Score 8 = votes 75–84)." />
        </div>
      </div>

      <div className="flex items-end gap-1 sm:gap-2 h-48">
        {data.map((d) => {
          const heightPx = (d.count / maxCount) * 160;
          const percentage = ((d.count / totalVotes) * 100).toFixed(0);
          return (
            <div
              key={d.score}
              className="flex-1 flex flex-col items-center justify-end gap-1 h-full group"
            >
              <div className="text-xs text-gray-500 dark:text-gray-400 text-center leading-tight">
                {d.count > 0 && <div>{d.count}</div>}
              </div>
              <div
                className="w-full rounded-t transition-colors relative bg-gradient-to-t from-primary-300 to-primary-200 dark:from-primary-800 dark:to-primary-700 group-hover:from-primary-400 group-hover:to-primary-300 dark:group-hover:from-primary-700 dark:group-hover:to-primary-600"
                style={{ height: `${Math.max(heightPx, 4)}px` }}
              >
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                  {d.count} votes ({percentage}%)
                </div>
              </div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {d.score}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
        <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0 text-sm text-gray-500 dark:text-gray-400">
          <span>Total votes: {totalVotes.toLocaleString()}{publicVotes != null && publicVotes < totalVotes && ` (${publicVotes.toLocaleString()} public)`}</span>
          <span>Most common: {data.reduce((max, d) => d.count > max.count ? d : max, data[0]).score}/10</span>
        </div>
      </div>
    </div>
  );
}
