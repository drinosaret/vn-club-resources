'use client';

import { useMemo } from 'react';
import Link from '@/components/Link';
import { getScoreFilterUrl, type EntityType } from '@/lib/vndb-url-helpers';
import { VNListDropdown } from './VNListDropdown';
import { ChartHelpTooltip } from './ChartHelpTooltip';

interface ScoreDistributionChartProps {
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
  headingLevel: Heading = 'h3',
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
      <div className="st-card p-6">
        <Heading className="st-card-title mb-4">Score Distribution</Heading>
        <p className="st-card-sub">No rating data available</p>
      </div>
    );
  }

  return (
    <div className="st-card p-6">
      <div className="st-card-head mb-4">
        <div className="flex items-center gap-2">
          <Heading className="st-card-title">Score Distribution</Heading>
          {tooltip && <ChartHelpTooltip text={tooltip} />}
        </div>
        <span className="fig-label">
          Avg <span className="st-num text-[color:var(--ink)]">{average.toFixed(1)}</span>
        </span>
      </div>

      <div className="flex items-end gap-2 h-48">
        {data.map((d) => {
          const heightPx = (d.count / maxCount) * 160; // 160px max height (leaving room for labels)
          const percentage = total > 0 ? ((d.count / total) * 100).toFixed(0) : '0';
          // An empty bucket takes no emphasis. Rounding the mean can land it on a score
          // nobody gave, and the highlight then points at a bar that stands for nothing.
          const isAverage = d.count > 0 && Math.round(average) === d.score;
          const browseUrl = entityType && entityId ? getScoreFilterUrl(entityType, entityId, d.score, entityName) : null;

          const barContent = (
            <>
              <div className="st-num text-center text-xs leading-tight text-[color:var(--nezu)]">
                {d.count > 0 && (
                  <>
                    <div>{d.count}</div>
                    {jpDistribution && d.jpCount > 0 && (
                      <div className="text-[10px] text-[color:var(--text-faint)]">({d.jpCount} JP)</div>
                    )}
                  </>
                )}
              </div>
              <div
                className={`relative w-full ${isAverage ? 'st-col st-col--on' : 'st-col'} ${
                  browseUrl ? 'st-col--pick' : ''
                }`}
                // The minimum is for a bar that exists. Giving an empty bucket the same
                // stub makes nothing look identical to a couple of titles.
                style={{ height: `${Math.max(heightPx, d.count > 0 ? 4 : 0)}px` }}
              >
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 st-tip on-box opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                  <div className="flex flex-col items-center">
                    <span>{d.count} VNs ({percentage}%)</span>
                    {jpDistribution && d.jpCount > 0 && (
                      <span className="text-[color:var(--ai)]">{d.jpCount} Japanese-original</span>
                    )}
                  </div>
                  {browseUrl && <div className="text-[color:var(--text-faint)] text-[10px]">Click to browse</div>}
                </div>
              </div>
              <div
                className={`st-num text-xs ${
                  isAverage ? 'text-[color:var(--ink)]' : 'text-[color:var(--nezu)]'
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

      <div className="mt-4 border-t border-[color:var(--rule)] pt-4">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-[color:var(--nezu)]">
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
