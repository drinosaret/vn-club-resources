'use client';

import { useMemo } from 'react';
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
    tooltip = 'Notable disagreement among voters. Opinions are spread across multiple score ranges.';
  } else {
    label = 'Love it or Hate it';
    tooltip = 'Sharply divided opinions. Votes cluster at opposite ends of the scale.';
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
    tooltip = 'Scores improved over time. Recent voters rate it higher than early voters by 0.3+ points.';
  } else if (diff < -0.3) {
    label = 'Hype Decay';
    tooltip = 'Early excitement faded. Scores dropped 0.3+ points from the initial reception period to recent votes.';
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
    tooltip = 'Vote rate is trending upward. The last 3 months show 10%+ more votes than the preceding period.';
  } else if (ratio >= 0.7) {
    label = 'Steady';
    tooltip = 'Vote rate is roughly stable, within 30% of the preceding 6-month average.';
  } else if (ratio >= 0.3) {
    label = 'Fading';
    tooltip = 'Vote rate has dropped significantly. The last 3 months are well below the preceding period.';
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
  detail: string;
}

function computeNicheQuadrant(
  rating: number | null,
  votecount: number,
  medians: GlobalMedians
): NicheQuadrantResult | null {
  if (rating === null) return null;

  // Use p75 as the dividing line (top 25% in each dimension)
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

  const detail = `${rating.toFixed(2)} rating · ${votecount.toLocaleString()} votes (p75: ${medians.p75_rating.toFixed(1)} / ${Math.round(medians.p75_votecount).toLocaleString()})`;

  return { label, x, y, tooltip, detail };
}

// ============ Main Component ============

const labelColors: Record<string, string> = {
  // Quadrant
  'Hidden Gem': 'text-emerald-600 dark:text-emerald-400',
  'Fan Favorite': 'text-amber-600 dark:text-amber-400',
  'Under the Radar': 'text-gray-500 dark:text-gray-400',
  'Mass Market': 'text-blue-600 dark:text-blue-400',
  // Polarization
  'Strong Consensus': 'text-emerald-600 dark:text-emerald-400',
  'Broad Agreement': 'text-sky-600 dark:text-sky-400',
  'Mixed Opinions': 'text-amber-600 dark:text-amber-400',
  'Love it or Hate it': 'text-rose-600 dark:text-rose-400',
  // Hype curve
  'Instant Classic': 'text-amber-600 dark:text-amber-400',
  'Sleeper Hit': 'text-emerald-600 dark:text-emerald-400',
  'Hype Decay': 'text-rose-600 dark:text-rose-400',
  // Velocity
  Surging: 'text-emerald-600 dark:text-emerald-400',
  Growing: 'text-sky-600 dark:text-sky-400',
  Fading: 'text-amber-600 dark:text-amber-400',
  Dormant: 'text-gray-500 dark:text-gray-400',
  // Shared
  Steady: 'text-blue-600 dark:text-blue-400',
};

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

  if (!polarization && !hypeCurve && !velocity && !nicheQuadrant) return null;

  const cardClass = 'rounded-lg p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200/40 dark:border-gray-700/40';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-5 border border-gray-200/60 dark:border-gray-700/80">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Insights</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {nicheQuadrant && (
          <div className={cardClass}>
            <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Popularity</div>
            <div className={`text-sm font-semibold mt-0.5 ${labelColors[nicheQuadrant.label] || 'text-gray-700 dark:text-gray-300'}`}>{nicheQuadrant.label}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{nicheQuadrant.tooltip}</div>
            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{nicheQuadrant.detail}</div>
          </div>
        )}
        {polarization && (
          <div className={cardClass}>
            <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Vote Spread</div>
            <div className={`text-sm font-semibold mt-0.5 ${labelColors[polarization.label] || 'text-gray-700 dark:text-gray-300'}`}>{polarization.label}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{polarization.tooltip}</div>
            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">σ = {polarization.stddev}</div>
          </div>
        )}
        {hypeCurve && (
          <div className={cardClass}>
            <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Score Trajectory</div>
            <div className={`text-sm font-semibold mt-0.5 ${labelColors[hypeCurve.label] || 'text-gray-700 dark:text-gray-300'}`}>{hypeCurve.label}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{hypeCurve.tooltip}</div>
            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Early avg {hypeCurve.earlyAvg.toFixed(1)} → Recent {hypeCurve.lateAvg.toFixed(1)}</div>
          </div>
        )}
        {velocity && (
          <div className={cardClass}>
            <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Vote Momentum</div>
            <div className={`text-sm font-semibold mt-0.5 ${labelColors[velocity.label] || 'text-gray-700 dark:text-gray-300'}`}>{velocity.label}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{velocity.tooltip}</div>
            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{velocity.recentRate.toFixed(0)}/mo (prev {velocity.baselineRate.toFixed(0)}/mo)</div>
          </div>
        )}
      </div>

      {/* Expandable legend */}
      <details className="mt-3 group">
        <summary className="text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 select-none list-none flex items-center gap-1">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4.5 2.5L8 6L4.5 9.5" /></svg>
          All categories
        </summary>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-gray-500 dark:text-gray-400">
          <div><span className="font-medium text-gray-600 dark:text-gray-300">Popularity:</span> Fan Favorite (≥p75 rating &amp; ≥p75 votes) · Hidden Gem (≥p75 rating, &lt;p75 votes) · Mass Market (&lt;p75 rating, ≥p75 votes) · Under the Radar (&lt;p75 both)</div>
          <div><span className="font-medium text-gray-600 dark:text-gray-300">Vote Spread:</span> Strong Consensus (σ&lt;1.3) · Broad Agreement (σ 1.3–1.8) · Mixed Opinions (σ 1.8–2.3) · Love it or Hate it (σ&gt;2.3)</div>
          <div><span className="font-medium text-gray-600 dark:text-gray-300">Score Trajectory:</span> Instant Classic (both ≥7.5, &lt;0.3 diff) · Sleeper Hit (&gt;+0.3) · Hype Decay (&gt;−0.3) · Steady (±0.3)</div>
          <div><span className="font-medium text-gray-600 dark:text-gray-300">Vote Momentum:</span> Surging (≥1.5x) · Growing (≥1.1x) · Steady (≥0.7x) · Fading (≥0.3x) · Dormant (&lt;0.3x)</div>
        </div>
      </details>
    </div>
  );
}
