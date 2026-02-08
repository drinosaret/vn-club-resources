'use client';

import { useMemo } from 'react';

interface MiniReleaseYearChartProps {
  distribution: Record<string, number>;
}

export function MiniReleaseYearChart({ distribution }: MiniReleaseYearChartProps) {
  const data = useMemo(() => {
    return Object.entries(distribution)
      .map(([year, count]) => ({ year: parseInt(year), count }))
      .filter(d => d.count > 0)
      .sort((a, b) => a.year - b.year);
  }, [distribution]);

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
        No data
      </div>
    );
  }

  const peakYear = data.reduce((max, d) => d.count > max.count ? d : max, data[0]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Release Years
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Peak: <span className="font-semibold text-primary-600 dark:text-primary-400">{peakYear.year}</span>
        </span>
      </div>

      <div className="flex-1 flex items-end gap-0.5 min-h-[80px]">
        {data.map((d) => {
          const heightPercent = (d.count / maxCount) * 100;
          const isPeak = d.year === peakYear.year;

          return (
            <div
              key={d.year}
              className="flex-1 flex flex-col items-center justify-end h-full group"
            >
              <div
                className={`w-full rounded-t transition-all duration-300 ${
                  isPeak
                    ? 'bg-primary-500'
                    : 'bg-primary-300 dark:bg-primary-700 group-hover:bg-primary-400 dark:group-hover:bg-primary-600'
                }`}
                style={{ height: `${Math.max(heightPercent, 3)}%` }}
              />
            </div>
          );
        })}
      </div>

      <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 mt-1">
        <span>{data[0]?.year}</span>
        <span>{data[data.length - 1]?.year}</span>
      </div>
    </div>
  );
}
