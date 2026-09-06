'use client';

import { useMemo } from 'react';
import Link from '@/components/Link';
import type { CategoryStats } from '@/lib/vndb-stats-api';
import { getAgeRatingFilterUrl, type EntityType } from '@/lib/vndb-url-helpers';
import { VNListDropdown } from './VNListDropdown';
import { ChartHelpTooltip } from './ChartHelpTooltip';

interface AgeRatingChartProps {
  /**
   * Heading level for this section's title.
   *
   * Defaults to a subsection, which is what it is on the global dashboard where these sit
   * under a heading of their own. A page that renders this directly under its title passes
   * 'h2', because jumping from the page heading straight to a third-level one leaves a gap
   * in the outline a screen reader reads as a missing section.
   */
  headingLevel?: 'h2' | 'h3';
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

const AGE_LABELS: Record<string, string> = {
  all_ages: 'All Ages (0-12)',
  teen: 'Teen (13-17)',
  adult: 'Adult (18+)',
};

const AGE_ORDER = ['all_ages', 'teen', 'adult'];

export function AgeRatingChart({ distribution, entityId, entityType, entityName, tooltip, headingLevel: Heading = 'h3' }: AgeRatingChartProps) {
  const data = useMemo(() => {
    return AGE_ORDER.map((key) => ({
      key,
      label: AGE_LABELS[key],
      shortLabel: key === 'all_ages' ? 'All Ages' : key === 'teen' ? 'Teen' : 'Adult',
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
      <div className="st-card p-6">
        <Heading className="st-card-title mb-4">
          Age Rating Distribution
        </Heading>
        <p className="text-[color:var(--nezu)]">
          Age rating data not available for these VNs.
        </p>
        <p className="text-xs text-[color:var(--text-faint)] mt-1">
          This data comes from release information which may not be fully imported yet.
        </p>
      </div>
    );
  }

  // Find most common age rating
  const peakAge = data.reduce((max, d) => d.count > max.count ? d : max, data[0]);

  return (
    <div className="st-card p-6">
      <div className="st-card-head mb-4">
        <div className="flex items-center gap-2">
          <Heading className="st-card-title">
            Age Rating
          </Heading>
          {tooltip && <ChartHelpTooltip text={tooltip} />}
        </div>
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
      </div>

      <div className="relative h-48">
        {/* Y-axis labels (left - count) */}
        <div className="absolute left-0 top-0 h-36 w-8 flex flex-col justify-between font-mono text-xs tabular-nums text-[color:var(--text-faint)]">
          <span>{maxCount}</span>
          <span>{Math.round(maxCount / 2)}</span>
          <span>0</span>
        </div>

        {/* Y-axis labels (right - rating) */}
        <div className="absolute right-0 top-0 h-36 w-6 flex flex-col justify-between text-right font-mono text-xs tabular-nums text-[color:var(--ai)]">
          <span>10</span>
          <span>5</span>
          <span>0</span>
        </div>

        {/* Chart area */}
        <div className="mx-4 sm:mx-10 h-36 flex items-end justify-around">
          {data.map((d) => {
            const barHeight = (d.count / maxCount) * 130;
            const dotPosition = d.avgRating > 0 ? ((d.avgRating / 10) * 130) : 0;
            const isPeak = d.key === peakAge.key && d.count > 0;
            const browseUrl = entityType && entityId ? getAgeRatingFilterUrl(entityType, entityId, d.key, entityName) : null;

            const barContent = (
              <>
                {/* Rating dot */}
                {d.avgRating > 0 && (
                  <div
                    className="absolute z-10 h-3 w-3 rounded-xs border-2 border-[color:var(--surface)] bg-[color:var(--ai)]"
                    style={{ bottom: `${dotPosition}px` }}
                  />
                )}

                {/* Bar */}
                <div
                  className={`relative w-full ${
                    isPeak
                      ? 'st-col st-col--on'
                      : 'st-col'
                  } ${browseUrl ? 'st-col--pick' : ''}`}
                  style={{ height: `${Math.max(barHeight, d.count > 0 ? 4 : 0)}px` }}
                >
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 st-tip on-box opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-20">
                    <div className="flex flex-col items-center">
                      <span>
                        {d.label}: {d.count} VNs
                        {d.avgRating > 0 && <span className="text-[color:var(--ai)]"> ({d.avgRating.toFixed(1)})</span>}
                      </span>
                      {hasJpCounts && d.jpCount > 0 && (
                        <span className="text-[color:var(--ai)]">{d.jpCount} Japanese-original</span>
                      )}
                    </div>
                    {browseUrl && <div className="text-[color:var(--text-faint)] text-[10px]">Click to browse</div>}
                  </div>
                </div>
              </>
            );

            return browseUrl ? (
              <Link
                key={d.key}
                href={browseUrl}
                className="flex flex-col items-center justify-end group h-full relative cursor-pointer"
                style={{ width: '30%' }}
              >
                {barContent}
              </Link>
            ) : (
              <div
                key={d.key}
                className="flex flex-col items-center justify-end group h-full relative"
                style={{ width: '30%' }}
              >
                {barContent}
              </div>
            );
          })}
        </div>

        {/* X-axis labels */}
        <div className="mx-4 sm:mx-10 mt-2 flex justify-around font-mono text-xs tabular-nums text-[color:var(--text-faint)]">
          {data.map((d) => (
            <span key={d.key} className="text-center" style={{ width: '30%' }}>
              {d.shortLabel}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-[color:var(--rule)]">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-[color:var(--nezu)]">
          <span>Most common: <span className="text-[color:var(--ink)]">{peakAge.shortLabel}</span></span>
          <span>VNs with age rating: {total.toLocaleString()}</span>
        </div>
      </div>

      {/* VN List Dropdown (only for tag/trait which have backend category endpoints) */}
      {entityId && entityType && (entityType === 'tag' || entityType === 'trait') && (
        <VNListDropdown
          entityId={entityId}
          entityType={entityType}
          categoryType="age_rating"
          categoryOptions={data.map(d => ({
            value: d.key,
            label: d.label,
            count: d.count,
          }))}
          label="View VNs by Age Rating"
        />
      )}
    </div>
  );
}
