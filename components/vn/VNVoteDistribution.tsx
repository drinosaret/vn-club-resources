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
      <section className="vn-sec p-4 sm:p-5">
        <div className="vn-sec-head">
          <h2 className="vn-sec-title">Vote Distribution</h2>
        </div>
        <p className="text-[color:var(--nezu)]">No votes recorded yet</p>
      </section>
    );
  }

  return (
    <section className="vn-sec p-4 sm:p-5">
      <div className="vn-sec-head">
        <div className="flex items-center gap-1.5">
          <h2 className="vn-sec-title">Vote Distribution</h2>
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
              <div className="vn-num text-[10px] text-[color:var(--nezu)] text-center leading-tight">
                {d.count > 0 && <div>{d.count}</div>}
              </div>
              {/* Amber is the fill for a live count. It carries no word here, only height. */}
              <div
                className="w-full relative bg-[color:var(--kohaku)] transition-opacity opacity-80 group-hover:opacity-100"
                style={{ height: `${Math.max(heightPx, 4)}px` }}
              >
                <div className="on-box absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-xs bg-[color:var(--box)] text-[color:var(--ink-box)] text-xs opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                  {d.count} votes ({percentage}%)
                </div>
              </div>
              <div className="vn-num text-xs text-[color:var(--nezu)]">
                {d.score}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-[color:var(--rule)]">
        <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0 text-sm text-[color:var(--nezu)]">
          <span>Total votes: <span className="vn-num">{totalVotes.toLocaleString()}</span>{publicVotes != null && publicVotes < totalVotes && <> (<span className="vn-num">{publicVotes.toLocaleString()}</span> public)</>}</span>
          <span>Most common: <span className="vn-num">{data.reduce((max, d) => d.count > max.count ? d : max, data[0]).score}/10</span></span>
        </div>
      </div>
    </section>
  );
}
