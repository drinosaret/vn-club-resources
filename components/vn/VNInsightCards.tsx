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

/**
 * Where a verdict sits on its own scale: rising or strong, falling or weak, the middle of the
 * scale, or the atypical one worth stopping on. A panel of verdicts otherwise renders as four
 * identical plates, which is a sentence each to read rather than a glance.
 */
type Tone = 'up' | 'down' | 'flat' | 'mark';

const TONE_CLASS: Record<Tone, string> = {
  up: 'nameplate nameplate--up',
  down: 'nameplate nameplate--down',
  flat: 'nameplate nameplate--plain',
  mark: 'nameplate',
};

interface PolarizationResult {
  label: string;
  tone: Tone;
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
  let tone: Tone;
  // Agreement is what makes the average worth trusting, so the tight end reads as the strong
  // one. A split vote is a finding rather than a failing, so it takes the standout.
  if (stddev < 1.3) {
    label = 'Strong Consensus';
    tone = 'up';
    tooltip = 'Voters strongly agree on this title. Most scores cluster tightly around the average.';
  } else if (stddev < 1.8) {
    label = 'Broad Agreement';
    tone = 'flat';
    tooltip = 'General agreement with natural variance. Some spread across scores but no major disagreement.';
  } else if (stddev < 2.3) {
    label = 'Mixed Opinions';
    tone = 'flat';
    tooltip = 'Notable disagreement among voters. Opinions are spread across multiple score ranges.';
  } else {
    label = 'Love it or Hate it';
    tone = 'mark';
    tooltip = 'Sharply divided opinions. Votes cluster at opposite ends of the scale.';
  }

  return { label, tone, stddev: Math.round(stddev * 100) / 100, normalized, tooltip };
}

interface HypeCurveResult {
  label: string;
  tone: Tone;
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
  let tone: Tone;
  if (earlyAvg >= 7.5 && lateAvg >= 7.5 && Math.abs(diff) < 0.3) {
    label = 'Instant Classic';
    tone = 'up';
    tooltip = 'Consistently high scores from release to present. Both early and recent voters average 7.5+ with less than 0.3 difference.';
  } else if (diff > 0.3) {
    label = 'Sleeper Hit';
    tone = 'up';
    tooltip = 'Scores improved over time. Recent voters rate it higher than early voters by 0.3+ points.';
  } else if (diff < -0.3) {
    label = 'Hype Decay';
    tone = 'down';
    tooltip = 'Early excitement faded. Scores dropped 0.3+ points from the initial reception period to recent votes.';
  } else {
    label = 'Steady';
    tone = 'flat';
    tooltip = 'Score has remained stable over time, with less than 0.3 points difference between early and recent voters.';
  }

  return {
    label,
    tone,
    earlyAvg: Math.round(earlyAvg * 100) / 100,
    lateAvg: Math.round(lateAvg * 100) / 100,
    tooltip,
  };
}

interface VoteVelocityResult {
  label: string;
  tone: Tone;
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
  let tone: Tone;
  if (ratio >= 1.5) {
    label = 'Surging';
    tone = 'up';
    tooltip = 'Vote rate in the last 3 months is 50%+ higher than the preceding 6 months. Interest is spiking.';
  } else if (ratio >= 1.1) {
    label = 'Growing';
    tone = 'up';
    tooltip = 'Vote rate is trending upward. The last 3 months show 10%+ more votes than the preceding period.';
  } else if (ratio >= 0.7) {
    label = 'Steady';
    tone = 'flat';
    tooltip = 'Vote rate is roughly stable, within 30% of the preceding 6-month average.';
  } else if (ratio >= 0.3) {
    label = 'Fading';
    tone = 'down';
    tooltip = 'Vote rate has dropped significantly. The last 3 months are well below the preceding period.';
  } else {
    label = 'Dormant';
    tone = 'down';
    tooltip = 'Almost no votes in the last 3 months compared to before. This title is no longer actively being rated.';
  }

  return {
    label,
    tone,
    recentRate: Math.round(recentRate * 10) / 10,
    baselineRate: Math.round(baselineRate * 10) / 10,
    tooltip,
  };
}

interface NicheQuadrantResult {
  label: string;
  tone: Tone;
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
  let tone: Tone;
  // A title rated well above the size of its audience is the one a reader came here to find,
  // so it takes the standout rather than the ranked scale the other three sit on.
  if (highRating && !highPopularity) {
    label = 'Hidden Gem';
    tone = 'mark';
    tooltip = `Rated above the 75th percentile (${medians.p75_rating.toFixed(1)}+) but with fewer votes than most top-rated titles. Underappreciated quality.`;
  } else if (highRating && highPopularity) {
    label = 'Fan Favorite';
    tone = 'up';
    tooltip = `Both highly rated (top 25%, ${medians.p75_rating.toFixed(1)}+) and widely played (${Math.round(medians.p75_votecount)}+ votes). A proven hit.`;
  } else if (!highRating && !highPopularity) {
    label = 'Under the Radar';
    tone = 'flat';
    tooltip = `Below the 75th percentile in both rating and popularity. May appeal to niche audiences or be a lesser-known work.`;
  } else {
    label = 'Mass Market';
    tone = 'flat';
    tooltip = `Widely played (${Math.round(medians.p75_votecount)}+ votes) but rated below the top 25%. Popular but opinions vary.`;
  }

  // Normalize position: log scale for votecount, linear for rating
  const logVotes = Math.log10(Math.max(votecount, 1));
  const maxLogVotes = 5;
  const x = Math.min(Math.max(logVotes / maxLogVotes, 0.05), 0.95);
  const y = Math.min(Math.max((rating - 1) / 9, 0.05), 0.95);

  const detail = `${rating.toFixed(2)} rating · ${votecount.toLocaleString()} votes (p75: ${medians.p75_rating.toFixed(1)} / ${Math.round(medians.p75_votecount).toLocaleString()})`;

  return { label, tone, x, y, tooltip, detail };
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

  if (!polarization && !hypeCurve && !velocity && !nicheQuadrant) return null;

  // The verdict is the plate: which category a title falls in is the finding, and a plate says
  // it in the one place the eye lands. Its tone ranks it against the rest of its own scale, so
  // a reader takes the shape of all four before reading any of them.
  const cards: Array<{ caption: string; verdict: string; tone: Tone; blurb: string; detail: string }> = [];
  if (nicheQuadrant) cards.push({
    caption: 'Popularity',
    verdict: nicheQuadrant.label,
    tone: nicheQuadrant.tone,
    blurb: nicheQuadrant.tooltip,
    detail: nicheQuadrant.detail,
  });
  if (polarization) cards.push({
    caption: 'Vote Spread',
    verdict: polarization.label,
    tone: polarization.tone,
    blurb: polarization.tooltip,
    detail: `σ = ${polarization.stddev}`,
  });
  if (hypeCurve) cards.push({
    caption: 'Score Trajectory',
    verdict: hypeCurve.label,
    tone: hypeCurve.tone,
    blurb: hypeCurve.tooltip,
    detail: `Early avg ${hypeCurve.earlyAvg.toFixed(1)} → Recent ${hypeCurve.lateAvg.toFixed(1)}`,
  });
  if (velocity) cards.push({
    caption: 'Vote Momentum',
    verdict: velocity.label,
    tone: velocity.tone,
    blurb: velocity.tooltip,
    detail: `${velocity.recentRate.toFixed(0)}/mo (prev ${velocity.baselineRate.toFixed(0)}/mo)`,
  });

  return (
    <section className="vn-sec p-4 sm:p-5">
      <div className="vn-sec-head">
        <h2 className="vn-sec-title">Insights</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map((card) => (
          <div key={card.caption} className="border-t border-[color:var(--rule)] pt-3">
            <span className="fig-label">{card.caption}</span>
            <div className="mt-1.5">
              <span className={TONE_CLASS[card.tone]}>{card.verdict}</span>
            </div>
            <p className="text-xs text-[color:var(--nezu)] mt-2 leading-relaxed">{card.blurb}</p>
            <p className="vn-num text-[11px] text-[color:var(--text-faint)] mt-1">{card.detail}</p>
          </div>
        ))}
      </div>

      {/* Expandable legend */}
      <details className="mt-4 group">
        <summary className="sec-more cursor-pointer select-none list-none">
          <span aria-hidden className="transition-transform group-open:rotate-90 inline-block">&rsaquo;</span>
          All categories
        </summary>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-[color:var(--nezu)]">
          <div><span className="font-medium text-[color:var(--ink)]">Popularity:</span> Fan Favorite (≥p75 rating &amp; ≥p75 votes) · Hidden Gem (≥p75 rating, &lt;p75 votes) · Mass Market (&lt;p75 rating, ≥p75 votes) · Under the Radar (&lt;p75 both)</div>
          <div><span className="font-medium text-[color:var(--ink)]">Vote Spread:</span> Strong Consensus (σ&lt;1.3) · Broad Agreement (σ 1.3–1.8) · Mixed Opinions (σ 1.8–2.3) · Love it or Hate it (σ&gt;2.3)</div>
          <div><span className="font-medium text-[color:var(--ink)]">Score Trajectory:</span> Instant Classic (both ≥7.5, &lt;0.3 diff) · Sleeper Hit (&gt;+0.3) · Hype Decay (&gt;−0.3) · Steady (±0.3)</div>
          <div><span className="font-medium text-[color:var(--ink)]">Vote Momentum:</span> Surging (≥1.5x) · Growing (≥1.1x) · Steady (≥0.7x) · Fading (≥0.3x) · Dormant (&lt;0.3x)</div>
        </div>
      </details>
    </section>
  );
}
