'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { CategoryStats } from '@/lib/vndb-stats-api';
import { getLengthFilterUrl, type EntityType } from '@/lib/vndb-url-helpers';
import { VNListDropdown } from './VNListDropdown';
import { ChartHelpTooltip } from './ChartHelpTooltip';

interface LengthChartProps {
  distribution: Record<string, CategoryStats>;
  /** Entity ID for links (e.g., "g106" for tag, "s123" for staff) */
  entityId?: string;
  /** Entity type for links */
  entityType?: EntityType;
  /** Entity display name (for browse page filter chip labels) */
  entityName?: string;
  /** Optional tooltip text explaining the chart */
  tooltip?: string;
}

const LENGTH_LABELS: Record<string, string> = {
  very_short: 'Very Short',
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
  very_long: 'Very Long',
};

const LENGTH_ORDER = ['very_short', 'short', 'medium', 'long', 'very_long'];

export function LengthChart({ distribution, entityId, entityType, entityName, tooltip }: LengthChartProps) {
  const data = useMemo(() => {
    return LENGTH_ORDER.map((key) => ({
      key,
      label: LENGTH_LABELS[key],
      count: distribution[key]?.count || 0,
      avgRating: distribution[key]?.avg_rating || 0,
      jpCount: distribution[key]?.jp_count || 0,
    }));
  }, [distribution]);

  const hasJpCounts = data.some(d => d.jpCount > 0);

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Length Distribution
        </h3>
        <p className="text-gray-500 dark:text-gray-400">No length data available</p>
      </div>
    );
  }

  // Find most common length
  const peakLength = data.reduce((max, d) => d.count > max.count ? d : max, data[0]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Length
          </h3>
          {tooltip && <ChartHelpTooltip text={tooltip} />}
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-gradient-to-t from-gray-400 to-gray-300 dark:from-gray-600 dark:to-gray-500 rounded-sm" />
            <span># Novels</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-blue-500 rounded-full" />
            <span>Avg Rating</span>
          </div>
        </div>
      </div>

      <div className="relative h-48">
        {/* Y-axis labels (left - count) */}
        <div className="absolute left-0 top-0 h-36 w-8 flex flex-col justify-between text-xs text-gray-400">
          <span>{maxCount}</span>
          <span>{Math.round(maxCount / 2)}</span>
          <span>0</span>
        </div>

        {/* Y-axis labels (right - rating) */}
        <div className="absolute right-0 top-0 h-36 w-6 flex flex-col justify-between text-xs text-blue-400 text-right">
          <span>10</span>
          <span>5</span>
          <span>0</span>
        </div>

        {/* Chart area */}
        <div className="mx-4 sm:mx-10 h-36 flex items-end justify-around">
          {data.map((d) => {
            const barHeight = (d.count / maxCount) * 130;
            const dotPosition = d.avgRating > 0 ? ((d.avgRating / 10) * 130) : 0;
            const isPeak = d.key === peakLength.key && d.count > 0;
            const browseUrl = entityType && entityId ? getLengthFilterUrl(entityType, entityId, d.key, entityName) : null;

            const barContent = (
              <>
                {/* Rating dot */}
                {d.avgRating > 0 && (
                  <div
                    className="absolute w-3 h-3 bg-blue-500 rounded-full border-2 border-white dark:border-gray-800 z-10"
                    style={{ bottom: `${dotPosition}px` }}
                  />
                )}

                {/* Bar */}
                <div
                  className={`w-full rounded-t transition-colors relative ${
                    isPeak
                      ? 'bg-gradient-to-t from-primary-600 to-primary-400'
                      : 'bg-gradient-to-t from-gray-400 to-gray-300 dark:from-gray-600 dark:to-gray-500 group-hover:from-gray-500 group-hover:to-gray-400 dark:group-hover:from-gray-500 dark:group-hover:to-gray-400'
                  } ${browseUrl ? 'group-hover:ring-2 group-hover:ring-primary-400 group-hover:ring-offset-1' : ''}`}
                  style={{ height: `${Math.max(barHeight, d.count > 0 ? 4 : 0)}px` }}
                >
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-20">
                    <div className="flex flex-col items-center">
                      <span>
                        {d.label}: {d.count} VNs
                        {d.avgRating > 0 && <span className="text-blue-300"> ({d.avgRating.toFixed(1)})</span>}
                      </span>
                      {hasJpCounts && d.jpCount > 0 && (
                        <span className="text-blue-300">{d.jpCount} Japanese-original</span>
                      )}
                    </div>
                    {browseUrl && <div className="text-gray-400 text-[10px]">Click to browse</div>}
                  </div>
                </div>
              </>
            );

            return browseUrl ? (
              <Link
                key={d.key}
                href={browseUrl}
                className="flex flex-col items-center justify-end group h-full relative cursor-pointer"
                style={{ width: '18%' }}
              >
                {barContent}
              </Link>
            ) : (
              <div
                key={d.key}
                className="flex flex-col items-center justify-end group h-full relative"
                style={{ width: '18%' }}
              >
                {barContent}
              </div>
            );
          })}
        </div>

        {/* X-axis labels */}
        <div className="mx-4 sm:mx-10 mt-2 flex justify-around text-xs text-gray-400">
          {data.map((d) => (
            <span key={d.key} className="text-center" style={{ width: '18%' }}>
              {d.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
        <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>Most common: <span className="font-semibold text-primary-600 dark:text-primary-400">{peakLength.label}</span></span>
          <span>VNs with length data: {total.toLocaleString()}</span>
        </div>
      </div>

      {/* VN List Dropdown (only for tag/trait which have backend category endpoints) */}
      {entityId && entityType && (entityType === 'tag' || entityType === 'trait') && (
        <VNListDropdown
          entityId={entityId}
          entityType={entityType}
          categoryType="length"
          categoryOptions={data.map(d => ({
            value: d.key,
            label: d.label,
            count: d.count,
          }))}
          label="View VNs by Length"
        />
      )}
    </div>
  );
}
