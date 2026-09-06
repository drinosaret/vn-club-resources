'use client';

import { useMemo, useState, useRef, useCallback } from 'react';
import Link from '@/components/Link';
import type { YearWithRating } from '@/lib/vndb-stats-api';
import { getReleaseYearFilterUrl, type EntityType } from '@/lib/vndb-url-helpers';
import { VNListDropdown } from './VNListDropdown';
import { ChartHelpTooltip } from './ChartHelpTooltip';

interface ReleaseYearChartProps {
  /**
   * Heading level for this section's title.
   *
   * Defaults to a subsection, which is what it is on the global dashboard where these sit
   * under a heading of their own. A page that renders this directly under its title passes
   * 'h2', because jumping from the page heading straight to a third-level one leaves a gap
   * in the outline a screen reader reads as a missing section.
   */
  headingLevel?: 'h2' | 'h3';
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

export function ReleaseYearChart({ distribution, distributionWithRatings, entityId, entityType, entityName, tooltip, headingLevel: Heading = 'h3' }: ReleaseYearChartProps) {
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
      <div className="st-card p-6">
        <Heading className="st-card-title mb-4">
          Release Years
        </Heading>
        <p className="text-[color:var(--nezu)]">No release year data available</p>
      </div>
    );
  }

  // Find peak year
  const peakYear = data.reduce((max, d) => d.count > max.count ? d : max, data[0]);

  // Get hovered year data
  const hoveredData = hoveredYear !== null ? data.find(d => d.year === hoveredYear) : null;

  return (
    <div className="st-card p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Heading className="st-card-title">
            Release Year
          </Heading>
          {tooltip && <ChartHelpTooltip text={tooltip} />}
        </div>
        <div className="flex items-center flex-wrap gap-3 sm:gap-4 text-xs sm:text-sm">
          {hasRatings && (
            <div className="fig-chart-legend">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 st-col" />
                <span># Novels</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-[color:var(--ai)] rounded-xs" />
                <span>Avg Rating</span>
              </div>
            </div>
          )}
          <div className="text-[color:var(--nezu)] transition-colors duration-100 whitespace-nowrap">
            {hoveredData ? (
              <span className="text-[color:var(--ink)]">
                {hoveredData.year}: {hoveredData.count} VNs
                {hoveredData.jp_count > 0 && <span className="text-[color:var(--nezu)] font-normal"> ({hoveredData.jp_count} JP)</span>}
                {hoveredData.avg_rating > 0 && <span className="text-[color:var(--ai)]"> ({hoveredData.avg_rating.toFixed(1)})</span>}
              </span>
            ) : (
              <span className="text-[color:var(--text-faint)]">
                Peak: <span className="text-[color:var(--ink)]">{peakYear.year}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="relative h-48">
        {/* Y-axis labels (left - count) */}
        <div className="absolute left-0 top-0 h-[168px] w-8 flex flex-col justify-between font-mono text-xs tabular-nums text-[color:var(--text-faint)] z-10 bg-[color:var(--surface)]">
          <span>{maxCount}</span>
          <span>{Math.round(maxCount / 2)}</span>
          <span>0</span>
        </div>

        {/* Y-axis labels (right - rating) - only show if we have ratings, hidden on mobile */}
        {hasRatings && (
          <div className="hidden sm:flex absolute right-0 top-0 h-[168px] w-6 flex-col justify-between text-right font-mono text-xs tabular-nums text-[color:var(--ai)] z-10 bg-[color:var(--surface)]">
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
                      className="absolute z-10 h-2.5 w-2.5 rounded-xs border-2 border-[color:var(--surface)] bg-[color:var(--ai)]"
                      style={{ bottom: `${dotPosition}px` }}
                    />
                  )}

                  {/* Bar */}
                  <div
                    className={`relative w-full st-col ${
                      isPeak || hoveredYear === d.year ? 'st-col--on' : ''
                    } ${browseUrl ? 'st-col--pick' : ''}`}
                    style={{ height: `${Math.max(heightPx, d.count > 0 ? 4 : 0)}px` }}
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
        <div className={`${hasRatings ? 'ml-8 mr-2 sm:ml-10 sm:mr-6' : 'ml-8 sm:ml-10 mr-2'} mt-2 flex justify-between text-xs text-[color:var(--text-faint)]`}>
          <span>{data[0]?.year}</span>
          <span>{data[data.length - 1]?.year}</span>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-[color:var(--rule)]">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-[color:var(--nezu)]">
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
