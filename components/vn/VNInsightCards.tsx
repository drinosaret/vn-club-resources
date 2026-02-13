'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { VNMonthlyVotes, VNMonthlyScore, GlobalMedians } from '@/lib/vndb-stats-api';

interface InsightCardsProps {
  scoreDistribution: Record<string, number>;
  scoreOverTime: VNMonthlyScore[];
  votesOverTime: VNMonthlyVotes[];
  rating: number | null;
  votecount: number;
  globalMedians?: GlobalMedians | null;
}

// ============ Calculation Functions ============

interface PolarizationResult {
  label: string;
  stddev: number;
  /** 0-1 normalized, higher = more divisive */
  normalized: number;
  tooltip: string;
}

function computePolarization(distribution: Record<string, number>): PolarizationResult | null {
  let totalVotes = 0;
  let weightedSum = 0;
  for (let i = 1; i <= 10; i++) {
    const count = distribution[String(i)] || 0;
    totalVotes += count;
    weightedSum += i * count;
  }
  if (totalVotes < 10) return null;

  const mean = weightedSum / totalVotes;
  let varianceSum = 0;
  for (let i = 1; i <= 10; i++) {
    const count = distribution[String(i)] || 0;
    varianceSum += count * Math.pow(i - mean, 2);
  }
  const stddev = Math.sqrt(varianceSum / totalVotes);

  // Typical range: ~0.8 (tight consensus) to ~3.0 (very divisive)
  const normalized = Math.min(Math.max((stddev - 0.8) / 2.2, 0), 1);

  let label: string;
  let tooltip: string;
  if (stddev < 1.3) {
    label = 'Strong Consensus';
    tooltip = 'Voters strongly agree on this title. Most scores cluster tightly around the average.';
  } else if (stddev < 1.8) {
    label = 'Broad Agreement';
    tooltip = 'General agreement with natural variance. Some spread across scores but no major disagreement.';
  } else if (stddev < 2.3) {
    label = 'Mixed Opinions';
    tooltip = 'Notable disagreement among voters — opinions are spread across multiple score ranges.';
  } else {
    label = 'Love it or Hate it';
    tooltip = 'Sharply divided opinions. Votes cluster at opposite ends of the scale — a true marmite title.';
  }

  return { label, stddev: Math.round(stddev * 100) / 100, normalized, tooltip };
}

interface HypeCurveResult {
  label: string;
  earlyAvg: number;
  lateAvg: number;
  tooltip: string;
}

function computeHypeCurve(scoreOverTime: VNMonthlyScore[]): HypeCurveResult | null {
  if (scoreOverTime.length < 6) return null;

  const quarterLen = Math.max(Math.floor(scoreOverTime.length * 0.25), 1);
  const earlySlice = scoreOverTime.slice(0, quarterLen);
  const lateSlice = scoreOverTime.slice(-quarterLen);

  const weightedAvg = (slice: VNMonthlyScore[]) => {
    let sum = 0;
    let count = 0;
    for (const m of slice) {
      sum += m.avg_score * m.vote_count;
      count += m.vote_count;
    }
    return count > 0 ? sum / count : 0;
  };

  const earlyAvg = weightedAvg(earlySlice);
  const lateAvg = weightedAvg(lateSlice);
  const diff = lateAvg - earlyAvg;

  let label: string;
  let tooltip: string;
  if (earlyAvg >= 7.5 && lateAvg >= 7.5 && Math.abs(diff) < 0.3) {
    label = 'Instant Classic';
    tooltip = 'Consistently high scores from release to present. Both early and recent voters average 7.5+ with less than 0.3 difference.';
  } else if (diff > 0.3) {
    label = 'Sleeper Hit';
    tooltip = 'Scores improved over time — recent voters rate it higher than early voters by 0.3+ points. Word of mouth may have helped.';
  } else if (diff < -0.3) {
    label = 'Hype Decay';
    tooltip = 'Early excitement faded — scores dropped 0.3+ points from the initial reception period to recent votes.';
  } else {
    label = 'Steady';
    tooltip = 'Score has remained stable over time, with less than 0.3 points difference between early and recent voters.';
  }

  return {
    label,
    earlyAvg: Math.round(earlyAvg * 100) / 100,
    lateAvg: Math.round(lateAvg * 100) / 100,
    tooltip,
  };
}

interface VoteVelocityResult {
  label: string;
  recentRate: number;
  baselineRate: number;
  tooltip: string;
}

function computeVoteVelocity(votesOverTime: VNMonthlyVotes[]): VoteVelocityResult | null {
  if (votesOverTime.length < 6) return null;

  // Compare last 3 months against the preceding 6 months (not lifetime)
  // This captures actual momentum rather than comparing against the post-release spike
  const last3 = votesOverTime.slice(-3);
  const recentVotes = last3.reduce((sum, m) => sum + m.count, 0);
  const recentRate = recentVotes / 3;

  const preceding = votesOverTime.slice(-9, -3);
  const precedingVotes = preceding.reduce((sum, m) => sum + m.count, 0);
  const baselineRate = precedingVotes / preceding.length;

  const ratio = baselineRate > 0 ? recentRate / baselineRate : (recentRate > 0 ? 2 : 0);

  let label: string;
  let tooltip: string;
  if (ratio >= 1.5) {
    label = 'Surging';
    tooltip = 'Vote rate in the last 3 months is 50%+ higher than the preceding 6 months. Interest is spiking.';
  } else if (ratio >= 1.1) {
    label = 'Growing';
    tooltip = 'Vote rate is trending upward — the last 3 months show 10%+ more votes than the preceding period.';
  } else if (ratio >= 0.7) {
    label = 'Steady';
    tooltip = 'Vote rate is roughly stable, within 30% of the preceding 6-month average.';
  } else if (ratio >= 0.3) {
    label = 'Fading';
    tooltip = 'Vote rate has dropped significantly — the last 3 months are well below the preceding period.';
  } else {
    label = 'Dormant';
    tooltip = 'Almost no votes in the last 3 months compared to before. This title is no longer actively being rated.';
  }

  return {
    label,
    recentRate: Math.round(recentRate * 10) / 10,
    baselineRate: Math.round(baselineRate * 10) / 10,
    tooltip,
  };
}

interface NicheQuadrantResult {
  label: string;
  /** 0-1 X position (log-scaled votecount) */
  x: number;
  /** 0-1 Y position (rating) */
  y: number;
  tooltip: string;
}

function computeNicheQuadrant(
  rating: number | null,
  votecount: number,
  medians: GlobalMedians
): NicheQuadrantResult | null {
  if (rating === null) return null;

  // Use p75 as the dividing line — top 25% in each dimension
  const highRating = rating >= medians.p75_rating;
  const highPopularity = votecount >= medians.p75_votecount;

  let label: string;
  let tooltip: string;
  if (highRating && !highPopularity) {
    label = 'Hidden Gem';
    tooltip = `Rated above the 75th percentile (${medians.p75_rating.toFixed(1)}+) but with fewer votes than most top-rated titles. Underappreciated quality.`;
  } else if (highRating && highPopularity) {
    label = 'Fan Favorite';
    tooltip = `Both highly rated (top 25%, ${medians.p75_rating.toFixed(1)}+) and widely played (${Math.round(medians.p75_votecount)}+ votes). A proven hit.`;
  } else if (!highRating && !highPopularity) {
    label = 'Under the Radar';
    tooltip = `Below the 75th percentile in both rating and popularity. May appeal to niche audiences or be a lesser-known work.`;
  } else {
    label = 'Mass Market';
    tooltip = `Widely played (${Math.round(medians.p75_votecount)}+ votes) but rated below the top 25%. Popular but opinions vary.`;
  }

  // Normalize position: log scale for votecount, linear for rating
  const logVotes = Math.log10(Math.max(votecount, 1));
  const maxLogVotes = 5;
  const x = Math.min(Math.max(logVotes / maxLogVotes, 0.05), 0.95);
  const y = Math.min(Math.max((rating - 1) / 9, 0.05), 0.95);

  return { label, x, y, tooltip };
}

// ============ Sub-Components ============

function InfoTooltip({ content, wide }: { content: React.ReactNode; wide?: boolean }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ style: React.CSSProperties; arrowLeft: number } | null>(null);

  const showTooltip = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const tooltipWidth = wide ? 320 : 224;
    const margin = 12;
    const vw = window.innerWidth;
    const centerX = rect.left + rect.width / 2;

    // On narrow viewports, stretch tooltip to fill width
    if (vw < tooltipWidth + margin * 2 + 20) {
      setPos({
        style: {
          position: 'fixed',
          left: `${margin}px`,
          right: `${margin}px`,
          top: `${rect.top - 8}px`,
          transform: 'translateY(-100%)',
        },
        arrowLeft: centerX - margin,
      });
    } else {
      // Center on button, clamp to viewport edges
      let left = centerX - tooltipWidth / 2;
      left = Math.max(margin, Math.min(left, vw - tooltipWidth - margin));
      setPos({
        style: {
          position: 'fixed',
          left: `${left}px`,
          top: `${rect.top - 8}px`,
          transform: 'translateY(-100%)',
          width: `${tooltipWidth}px`,
        },
        arrowLeft: centerX - left,
      });
    }
  };

  const hideTooltip = () => setPos(null);

  // Dismiss tooltip on scroll or outside tap (mobile fix)
  useEffect(() => {
    if (!pos) return;
    const dismiss = () => setPos(null);
    const onClickOutside = (e: MouseEvent | TouchEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        dismiss();
      }
    };
    window.addEventListener('scroll', dismiss, { capture: true, passive: true });
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('touchstart', onClickOutside);
    return () => {
      window.removeEventListener('scroll', dismiss, { capture: true });
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('touchstart', onClickOutside);
    };
  }, [pos]);

  return (
    <span className="inline-flex ml-1">
      <button
        ref={buttonRef}
        type="button"
        className="w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300 text-[10px] font-bold leading-none flex items-center justify-center hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onClick={() => pos ? hideTooltip() : showTooltip()}
        aria-label="More info"
      >
        ?
      </button>
      {pos && (
        <div
          className="px-3 py-2 text-xs text-white bg-gray-900 dark:bg-gray-600 rounded-lg shadow-lg z-50 pointer-events-none"
          style={pos.style}
        >
          {content}
          <div
            className="absolute top-full -mt-px border-4 border-transparent border-t-gray-900 dark:border-t-gray-600"
            style={{ left: `${pos.arrowLeft}px`, transform: 'translateX(-50%)' }}
          />
        </div>
      )}
    </span>
  );
}

function OverviewTooltip() {
  return (
    <InfoTooltip
      wide
      content={
        <div className="space-y-2">
          <div>
            <div className="font-semibold">Rating vs Popularity</div>
            <div className="text-gray-300">Fan Favorite (top 25% in both) · Hidden Gem (high rating, fewer votes) · Mass Market (many votes, lower rating) · Under the Radar (below 75th percentile in both)</div>
          </div>
          <div>
            <div className="font-semibold">Vote Spread</div>
            <div className="text-gray-300">Strong Consensus (σ&lt;1.3) · Broad Agreement (1.3-1.8) · Mixed Opinions (1.8-2.3) · Love it or Hate it (σ&gt;2.3)</div>
          </div>
          <div>
            <div className="font-semibold">Score Trajectory</div>
            <div className="text-gray-300">Compares first 25% vs last 25% of months. Instant Classic (both ≥7.5, diff &lt;0.3) · Sleeper Hit (recent +0.3) · Hype Decay (recent -0.3) · Steady (diff &lt;0.3)</div>
          </div>
          <div>
            <div className="font-semibold">Vote Momentum</div>
            <div className="text-gray-300">Last 3 months vs preceding 6 months. Surging (1.5x+) · Growing (1.1x+) · Steady (0.7-1.1x) · Fading (0.3-0.7x) · Dormant (&lt;0.3x)</div>
          </div>
        </div>
      }
    />
  );
}

function NicheQuadrantMini({ result }: { result: NicheQuadrantResult }) {
  const quadrantColors = {
    'Hidden Gem': { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400' },
    'Fan Favorite': { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400' },
    'Under the Radar': { bg: 'bg-gray-50 dark:bg-gray-800/50', text: 'text-gray-600 dark:text-gray-400' },
    'Mass Market': { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400' },
  };
  const colors = quadrantColors[result.label as keyof typeof quadrantColors];

  return (
    <div className={`rounded-lg p-4 ${colors.bg} border border-gray-200/40 dark:border-gray-700/40`}>
      <div className="flex items-center gap-3">
        {/* Mini quadrant SVG */}
        <svg width="48" height="48" viewBox="0 0 48 48" className="flex-shrink-0">
          {/* Quadrant backgrounds */}
          <rect x="0" y="0" width="24" height="24" className="fill-emerald-200/50 dark:fill-emerald-900/30" />
          <rect x="24" y="0" width="24" height="24" className="fill-amber-200/50 dark:fill-amber-900/30" />
          <rect x="0" y="24" width="24" height="24" className="fill-gray-200/50 dark:fill-gray-700/30" />
          <rect x="24" y="24" width="24" height="24" className="fill-blue-200/50 dark:fill-blue-900/30" />
          {/* Grid lines */}
          <line x1="24" y1="0" x2="24" y2="48" className="stroke-gray-300 dark:stroke-gray-600" strokeWidth="1" />
          <line x1="0" y1="24" x2="48" y2="24" className="stroke-gray-300 dark:stroke-gray-600" strokeWidth="1" />
          {/* VN dot — y is inverted (higher rating = lower y in SVG) */}
          <circle
            cx={result.x * 48}
            cy={(1 - result.y) * 48}
            r="4"
            className="fill-primary-500 dark:fill-primary-400 stroke-white dark:stroke-gray-900"
            strokeWidth="1.5"
          />
        </svg>
        <div>
          <div className="flex items-center">
            <span className={`text-sm font-semibold ${colors.text}`}>{result.label}</span>
            <InfoTooltip content={result.tooltip} />
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Rating vs Popularity</div>
        </div>
      </div>
    </div>
  );
}

function InsightCard({
  label,
  subtitle,
  value,
  colorClass,
  tooltip,
}: {
  label: string;
  subtitle: string;
  value?: string;
  colorClass: string;
  tooltip?: string;
}) {
  return (
    <div className="rounded-lg p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200/40 dark:border-gray-700/40">
      <div className="flex items-center">
        <span className={`text-sm font-semibold ${colorClass}`}>{label}</span>
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      {value && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{value}</div>
      )}
      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">{subtitle}</div>
    </div>
  );
}

// ============ Main Component ============

export function VNInsightCards({
  scoreDistribution,
  scoreOverTime,
  votesOverTime,
  rating,
  votecount,
  globalMedians,
}: InsightCardsProps) {
  const polarization = useMemo(() => computePolarization(scoreDistribution), [scoreDistribution]);
  const hypeCurve = useMemo(() => computeHypeCurve(scoreOverTime), [scoreOverTime]);
  const velocity = useMemo(() => computeVoteVelocity(votesOverTime), [votesOverTime]);
  const nicheQuadrant = useMemo(
    () => (globalMedians ? computeNicheQuadrant(rating, votecount, globalMedians) : null),
    [rating, votecount, globalMedians]
  );

  // Don't render if none of the insights are available
  if (!polarization && !hypeCurve && !velocity && !nicheQuadrant) return null;

  const polarizationColors: Record<string, string> = {
    'Strong Consensus': 'text-emerald-700 dark:text-emerald-400',
    'Broad Agreement': 'text-sky-700 dark:text-sky-400',
    'Mixed Opinions': 'text-amber-700 dark:text-amber-400',
    'Love it or Hate it': 'text-rose-700 dark:text-rose-400',
  };

  const hypeCurveColors: Record<string, string> = {
    'Instant Classic': 'text-amber-700 dark:text-amber-400',
    'Sleeper Hit': 'text-emerald-700 dark:text-emerald-400',
    'Hype Decay': 'text-rose-700 dark:text-rose-400',
    'Steady': 'text-blue-700 dark:text-blue-400',
  };

  const velocityColors: Record<string, string> = {
    Surging: 'text-emerald-700 dark:text-emerald-400',
    Growing: 'text-sky-700 dark:text-sky-400',
    Steady: 'text-blue-700 dark:text-blue-400',
    Fading: 'text-amber-700 dark:text-amber-400',
    Dormant: 'text-gray-600 dark:text-gray-400',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
        At a Glance
        <OverviewTooltip />
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {nicheQuadrant && <NicheQuadrantMini result={nicheQuadrant} />}
        {polarization && (
          <InsightCard
            label={polarization.label}
            subtitle="Vote Spread"
            value={`σ = ${polarization.stddev}`}
            colorClass={polarizationColors[polarization.label] || 'text-gray-700 dark:text-gray-300'}
            tooltip={polarization.tooltip}
          />
        )}
        {hypeCurve && (
          <InsightCard
            label={hypeCurve.label}
            subtitle="Score Trajectory"
            value={`Early avg ${hypeCurve.earlyAvg.toFixed(1)} → Recent ${hypeCurve.lateAvg.toFixed(1)}`}
            colorClass={hypeCurveColors[hypeCurve.label] || 'text-gray-700 dark:text-gray-300'}
            tooltip={hypeCurve.tooltip}
          />
        )}
        {velocity && (
          <InsightCard
            label={velocity.label}
            subtitle="Vote Momentum"
            value={`${velocity.recentRate.toFixed(0)}/mo (prev ${velocity.baselineRate.toFixed(0)}/mo)`}
            colorClass={velocityColors[velocity.label] || 'text-gray-700 dark:text-gray-300'}
            tooltip={velocity.tooltip}
          />
        )}
      </div>
    </div>
  );
}
