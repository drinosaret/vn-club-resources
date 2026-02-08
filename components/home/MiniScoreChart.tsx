'use client';

import { useMemo } from 'react';

interface MiniScoreChartProps {
  distribution: Record<string, number>;
  average?: number;
}

export function MiniScoreChart({ distribution, average }: MiniScoreChartProps) {
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

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Score Distribution
        </span>
        {average && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Avg: <span className="font-semibold text-primary-600 dark:text-primary-400">{average.toFixed(1)}</span>
          </span>
        )}
      </div>

      <div className="flex-1 flex items-end gap-1 min-h-[80px]">
        {data.map((d) => {
          const heightPercent = (d.count / maxCount) * 100;
          const isAverage = average ? Math.round(average) === d.score : false;

          return (
            <div
              key={d.score}
              className="flex-1 flex flex-col items-center justify-end gap-0.5 h-full group"
            >
              <div
                className={`w-full rounded-t transition-all duration-300 ${
                  isAverage
                    ? 'bg-primary-500'
                    : 'bg-primary-300 dark:bg-primary-700 group-hover:bg-primary-400 dark:group-hover:bg-primary-600'
                }`}
                style={{ height: `${Math.max(heightPercent, 3)}%` }}
              />
              <span className={`text-[10px] ${
                isAverage
                  ? 'text-primary-600 dark:text-primary-400 font-semibold'
                  : 'text-gray-400 dark:text-gray-500'
              }`}>
                {d.score}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
