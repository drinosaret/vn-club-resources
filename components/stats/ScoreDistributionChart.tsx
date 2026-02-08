'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { getScoreFilterUrl, type EntityType } from '@/lib/vndb-url-helpers';
import { VNListDropdown } from './VNListDropdown';
import { ChartHelpTooltip } from './ChartHelpTooltip';

interface ScoreDistributionChartProps {
  distribution: Record<string, number>;
  /** JP-original VN counts per score bucket (olang='ja') */
  jpDistribution?: Record<string, number>;
  average: number;
  /** Entity ID for links (e.g., "g106" for tag, "s123" for staff) */
  entityId?: string;
  /** Entity type for links */
  entityType?: EntityType;
  /** Entity display name (for browse page filter chip labels) */
  entityName?: string;
  /** Optional tooltip text explaining the chart */
  tooltip?: string;
}

export function ScoreDistributionChart({
  distribution,
  jpDistribution,
  average,
  entityId,
  entityType,
  entityName,
  tooltip,
}: ScoreDistributionChartProps) {
  const data = useMemo(() => {
    const scores = [];
    for (let i = 1; i <= 10; i++) {
      scores.push({
        score: i,
        count: distribution[String(i)] || 0,
        jpCount: jpDistribution?.[String(i)] || 0,
      });
    }
    return scores;
  }, [distribution, jpDistribution]);

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Score Distribution
        </h3>
        <p className="text-gray-500 dark:text-gray-400">No rating data available</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Score Distribution
          </h3>
          {tooltip && <ChartHelpTooltip text={tooltip} />}
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Avg: <span className="font-semibold text-primary-600 dark:text-primary-400">{average.toFixed(1)}</span>
        </div>
      </div>

      <div className="flex items-end gap-2 h-48">
        {data.map((d) => {
          const heightPx = (d.count / maxCount) * 160; // 160px max height (leaving room for labels)
          const percentage = total > 0 ? ((d.count / total) * 100).toFixed(0) : '0';
          const isAverage = Math.round(average) === d.score;
          const browseUrl = entityType && entityId ? getScoreFilterUrl(entityType, entityId, d.score, entityName) : null;

          const barContent = (
            <>
              <div className="text-xs text-gray-500 dark:text-gray-400 text-center leading-tight">
                {d.count > 0 && (
                  <>
                    <div>{d.count}</div>
                    {jpDistribution && d.jpCount > 0 && (
                      <div className="text-[10px] text-gray-400 dark:text-gray-500">({d.jpCount} JP)</div>
                    )}
                  </>
                )}
              </div>
              <div
                className={`w-full rounded-t transition-colors relative ${
                  isAverage
                    ? 'bg-gradient-to-t from-primary-600 to-primary-400'
                    : 'bg-gradient-to-t from-primary-300 to-primary-200 dark:from-primary-800 dark:to-primary-700 group-hover:from-primary-400 group-hover:to-primary-300 dark:group-hover:from-primary-700 dark:group-hover:to-primary-600'
                } ${browseUrl ? 'group-hover:ring-2 group-hover:ring-primary-400 group-hover:ring-offset-1' : ''}`}
                style={{ height: `${Math.max(heightPx, 4)}px` }}
              >
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                  <div className="flex flex-col items-center">
                    <span>{d.count} VNs ({percentage}%)</span>
                    {jpDistribution && d.jpCount > 0 && (
                      <span className="text-blue-300">{d.jpCount} Japanese-original</span>
                    )}
                  </div>
                  {browseUrl && <div className="text-gray-400 text-[10px]">Click to browse</div>}
                </div>
              </div>
              <div
                className={`text-xs font-medium ${
                  isAverage
                    ? 'text-primary-600 dark:text-primary-400'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {d.score}
              </div>
            </>
          );

          return browseUrl ? (
            <Link
              key={d.score}
              href={browseUrl}
              className="flex-1 flex flex-col items-center justify-end gap-1 h-full cursor-pointer group"
            >
              {barContent}
            </Link>
          ) : (
            <div
              key={d.score}
              className="flex-1 flex flex-col items-center justify-end gap-1 h-full group"
            >
              {barContent}
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
        <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>VNs with ratings: {total.toLocaleString()}</span>
          <span>Most common: {data.reduce((max, d) => d.count > max.count ? d : max, data[0]).score}/10</span>
        </div>
      </div>

      {/* VN List Dropdown (only for tag/trait which have backend category endpoints) */}
      {entityId && entityType && (entityType === 'tag' || entityType === 'trait') && (
        <VNListDropdown
          entityId={entityId}
          entityType={entityType}
          categoryType="score"
          categoryOptions={data.map(d => ({
            value: d.score.toString(),
            label: `Score ${d.score}`,
            count: d.count,
          }))}
          label="View VNs by Score"
        />
      )}
    </div>
  );
}
