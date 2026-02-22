'use client';

import { useMemo, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import type { YearWithRating } from '@/lib/vndb-stats-api';
import { getReleaseYearFilterUrl, type EntityType } from '@/lib/vndb-url-helpers';
import { VNListDropdown } from './VNListDropdown';
import { ChartHelpTooltip } from './ChartHelpTooltip';

interface ReleaseYearChartProps {
  distribution: Record<string, number>;
  distributionWithRatings?: YearWithRating[];
  /** Entity ID for links (e.g., "g106" for tag, "s123" for staff) */
  entityId?: string;
  /** Entity type for links */
  entityType?: EntityType;
  /** Entity display name (for browse page filter chip labels) */
  entityName?: string;
  /** Optional tooltip text explaining the chart */
  tooltip?: string;
}

export function ReleaseYearChart({ distribution, distributionWithRatings, entityId, entityType, entityName, tooltip }: ReleaseYearChartProps) {
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const clearTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced clear to prevent flash when moving between bars
  const clearHover = useCallback(() => {
    clearTimeoutRef.current = setTimeout(() => {
      setHoveredYear(null);
    }, 50);
  }, []);

  const setHover = useCallback((year: number) => {
    // Cancel any pending clear
    if (clearTimeoutRef.current) {
      clearTimeout(clearTimeoutRef.current);
      clearTimeoutRef.current = null;
    }
    setHoveredYear(year);
  }, []);

  const data = useMemo(() => {
    // Get raw data with counts > 0
    let rawData: { year: number; count: number; avg_rating: number; jp_count: number }[];

    if (distributionWithRatings && distributionWithRatings.length > 0) {
      rawData = distributionWithRatings
        .filter(d => d.count > 0)
        .map(d => ({ year: d.year, count: d.count, avg_rating: d.avg_rating, jp_count: d.jp_count ?? 0 }));
    } else {
      rawData = Object.entries(distribution)
        .map(([year, count]) => ({ year: parseInt(year), count, avg_rating: 0, jp_count: 0 }))
        .filter(d => d.count > 0);
    }

    if (rawData.length === 0) return [];

    // Find year range and fill in gaps to avoid visual holes
    const years = rawData.map(d => d.year);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);

    const dataMap = new Map(rawData.map(d => [d.year, d]));
    const filledData: typeof rawData = [];

    // If the range spans more than 40 years, only include years with actual data
    // to avoid creating hundreds of empty entries for outlier years
    if (maxYear - minYear > 40) {
      return rawData.sort((a, b) => a.year - b.year);
    }

    for (let year = minYear; year <= maxYear; year++) {
      filledData.push(dataMap.get(year) ?? { year, count: 0, avg_rating: 0, jp_count: 0 });
    }

    return filledData;
  }, [distribution, distributionWithRatings]);

  const hasRatings = data.some(d => d.avg_rating > 0);
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((sum, d) => sum + d.count, 0);

  if (data.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Release Years
        </h3>
        <p className="text-gray-500 dark:text-gray-400">No release year data available</p>
      </div>
    );
  }

  // Find peak year
  const peakYear = data.reduce((max, d) => d.count > max.count ? d : max, data[0]);

  // Get hovered year data
  const hoveredData = hoveredYear !== null ? data.find(d => d.year === hoveredYear) : null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Release Year
          </h3>
          {tooltip && <ChartHelpTooltip text={tooltip} />}
        </div>
        <div className="flex items-center flex-wrap gap-3 sm:gap-4 text-xs sm:text-sm">
          {hasRatings && (
            <div className="flex items-center gap-3 sm:gap-4 text-gray-400">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 bg-linear-to-t from-primary-300 to-primary-200 dark:from-primary-800 dark:to-primary-700 rounded-xs" />
                <span># Novels</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                <span>Avg Rating</span>
              </div>
            </div>
          )}
          <div className="text-gray-500 dark:text-gray-400 transition-colors duration-100 whitespace-nowrap">
            {hoveredData ? (
              <span className="font-semibold text-primary-600 dark:text-primary-400">
                {hoveredData.year}: {hoveredData.count} VNs
                {hoveredData.jp_count > 0 && <span className="text-gray-500 dark:text-gray-400 font-normal"> ({hoveredData.jp_count} JP)</span>}
                {hoveredData.avg_rating > 0 && <span className="text-blue-500"> ({hoveredData.avg_rating.toFixed(1)})</span>}
              </span>
            ) : (
              <span className="text-gray-400 dark:text-gray-500">
                Peak: <span className="font-semibold text-primary-600 dark:text-primary-400">{peakYear.year}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="relative h-48">
        {/* Y-axis labels (left - count) */}
        <div className="absolute left-0 top-0 h-[168px] w-8 flex flex-col justify-between text-xs text-gray-400 z-10 bg-white dark:bg-gray-800">
          <span>{maxCount}</span>
          <span>{Math.round(maxCount / 2)}</span>
          <span>0</span>
        </div>

        {/* Y-axis labels (right - rating) - only show if we have ratings, hidden on mobile */}
        {hasRatings && (
          <div className="hidden sm:flex absolute right-0 top-0 h-[168px] w-6 flex-col justify-between text-xs text-blue-400 text-right z-10 bg-white dark:bg-gray-800">
            <span>10</span>
            <span>5</span>
            <span>0</span>
          </div>
        )}

        {/* Chart container */}
        <div className={`${hasRatings ? 'ml-8 mr-2 sm:ml-10 sm:mr-6' : 'ml-8 sm:ml-10 mr-2'} h-[168px] overflow-x-auto scrollbar-thin`}>
          <div className="h-full flex items-end gap-px" style={{ minWidth: `${Math.max(data.length * 8, 100)}px` }}>
            {data.map((d) => {
              const heightPx = (d.count / maxCount) * 160; // 160px max height
              const dotPosition = d.avg_rating > 0 ? ((d.avg_rating / 10) * 160) : 0;
              const isPeak = d.year === peakYear.year;
              const browseUrl = entityType && entityId ? getReleaseYearFilterUrl(entityType, entityId, d.year, entityName) : null;

              const barContent = (
                <>
                  {/* Rating dot */}
                  {d.avg_rating > 0 && (
                    <div
                      className="absolute w-2.5 h-2.5 bg-blue-500 rounded-full border-2 border-white dark:border-gray-800 z-10"
                      style={{ bottom: `${dotPosition}px` }}
                    />
                  )}

                  {/* Bar */}
                  <div
                    className={`w-full rounded-t transition-colors duration-75 relative ${
                      isPeak
                        ? 'bg-linear-to-t from-primary-600 to-primary-400'
                        : hoveredYear === d.year
                          ? 'bg-linear-to-t from-primary-500 to-primary-300 dark:from-primary-600 dark:to-primary-400'
                          : 'bg-linear-to-t from-primary-300 to-primary-200 dark:from-primary-800 dark:to-primary-700 group-hover:from-primary-400 group-hover:to-primary-300 dark:group-hover:from-primary-700 dark:group-hover:to-primary-600'
                    } ${browseUrl ? 'group-hover:ring-2 group-hover:ring-primary-400 group-hover:ring-offset-1' : ''}`}
                    style={{ height: `${Math.max(heightPx, 4)}px` }}
                  />
                </>
              );

              return browseUrl ? (
                <Link
                  key={d.year}
                  href={browseUrl}
                  className="flex-1 flex flex-col items-center justify-end group h-full relative cursor-pointer"
                  onMouseEnter={() => !isTouchDevice && setHover(d.year)}
                  onMouseLeave={() => !isTouchDevice && clearHover()}
                  onTouchStart={(e) => {
                    setIsTouchDevice(true);
                    if (hoveredYear === d.year) {
                      // Second tap - allow navigation
                    } else {
                      // First tap - show info, prevent navigation
                      e.preventDefault();
                      setHover(d.year);
                    }
                  }}
                >
                  {barContent}
                </Link>
              ) : (
                <div
                  key={d.year}
                  className="flex-1 flex flex-col items-center justify-end group h-full relative cursor-pointer"
                  onMouseEnter={() => !isTouchDevice && setHover(d.year)}
                  onMouseLeave={() => !isTouchDevice && clearHover()}
                  onTouchStart={() => setIsTouchDevice(true)}
                  onClick={() => setHoveredYear(prev => prev === d.year ? null : d.year)}
                >
                  {barContent}
                </div>
              );
            })}
          </div>
        </div>

        {/* X-axis labels */}
        <div className={`${hasRatings ? 'ml-8 mr-2 sm:ml-10 sm:mr-6' : 'ml-8 sm:ml-10 mr-2'} mt-2 flex justify-between text-xs text-gray-400`}>
          <span>{data[0]?.year}</span>
          <span>{data[data.length - 1]?.year}</span>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
        <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>Range: {data[0]?.year} - {data[data.length - 1]?.year}</span>
          <span>VNs with release date: {total.toLocaleString()}</span>
        </div>
      </div>

      {/* VN List Dropdown (only for tag/trait which have backend category endpoints) */}
      {entityId && entityType && (entityType === 'tag' || entityType === 'trait') && (
        <VNListDropdown
          entityId={entityId}
          entityType={entityType}
          categoryType="release_year"
          categoryOptions={data.map(d => ({
            value: d.year.toString(),
            label: d.year.toString(),
            count: d.count,
          }))}
          label="View VNs by Year"
        />
      )}
    </div>
  );
}
