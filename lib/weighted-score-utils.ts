/**
 * Utility functions for calculating weighted scores across stats sections.
 * These match the approach used in TagsSection for consistency.
 */

/**
 * Calculate Bayesian (damped mean) score for rating-based items.
 * This adjusts ratings based on sample size - items with few data points
 * are pulled toward the global average.
 *
 * @param avgRating - The item's average rating (0-10)
 * @param count - Number of VNs/items
 * @param globalAvg - User's overall average rating (used as prior)
 * @param priorWeight - How strongly to weight the prior (default: 10)
 * @returns Bayesian score (0-10 range)
 */
export function calculateBayesianScore(
  avgRating: number,
  count: number,
  globalAvg: number,
  priorWeight: number = 10
): number {
  if (count === 0) return globalAvg;
  return (count * avgRating + priorWeight * globalAvg) / (count + priorWeight);
}

/**
 * Calculate weighted score from Bayesian score.
 * Applies a confidence penalty for items with low counts.
 * Returns a 0-100 scale score for consistency across all sections.
 *
 * @param bayesianScore - The Bayesian (damped mean) score (0-10 range)
 * @param count - Number of VNs/items
 * @param minConfidenceCount - Items need this many entries for full confidence (default: 3)
 * @returns Weighted score (0-100 range)
 */
export function calculateWeightedScore(
  bayesianScore: number,
  count: number,
  minConfidenceCount: number = 3
): number {
  const confidence = Math.min(1, count / minConfidenceCount);
  // Multiply by 10 to convert 0-10 bayesian to 0-100 scale
  return bayesianScore * confidence * 10;
}

/**
 * Calculate both Bayesian and weighted scores for a rating-based item.
 * Convenience function that combines both calculations.
 *
 * @param avgRating - The item's average rating (0-10)
 * @param count - Number of VNs/items
 * @param globalAvg - User's overall average rating
 * @param priorWeight - How strongly to weight the prior (default: 10)
 * @param minConfidenceCount - Items need this many entries for full confidence (default: 3)
 * @returns Object with bayesian_score and weighted_score
 */
export function calculateScores(
  avgRating: number,
  count: number,
  globalAvg: number,
  priorWeight: number = 10,
  minConfidenceCount: number = 3
): { bayesian_score: number; weighted_score: number } {
  const bayesian_score = calculateBayesianScore(avgRating, count, globalAvg, priorWeight);
  const weighted_score = calculateWeightedScore(bayesian_score, count, minConfidenceCount);
  return { bayesian_score, weighted_score };
}

/**
 * Calculate weighted score for frequency-based items (like Traits).
 * Since traits don't have ratings, we use frequency as the base value
 * and apply a confidence penalty based on VN count.
 *
 * @param frequency - Percentage of user's VNs with this trait (0-100)
 * @param vnCount - Number of VNs with this trait
 * @param minConfidenceCount - Items need this many VNs for full confidence (default: 3)
 * @returns Weighted frequency score
 */
export function calculateFrequencyWeightedScore(
  frequency: number,
  vnCount: number,
  minConfidenceCount: number = 3
): number {
  const confidence = Math.min(1, vnCount / minConfidenceCount);
  return frequency * confidence;
}

// ============ Tag Weight Utilities (IDF-based) ============

/** Estimated total VNs in VNDB for IDF calculation */
export const ESTIMATED_TOTAL_VNS = 50000;

/**
 * Calculate tag weight using IDF (Inverse Document Frequency).
 * Rarer tags get higher importance, combined with their applicability score.
 *
 * @param score - Tag applicability score (0-3 range from VNDB)
 * @param vnCount - Number of VNs with this tag (optional)
 * @param totalVNs - Approximate total VNs in VNDB (default: 50000)
 * @returns Weighted score for sorting
 */
export function calculateTagWeight(
  score: number,
  vnCount?: number,
  totalVNs: number = ESTIMATED_TOTAL_VNS
): number {
  // If no vn_count, fall back to score-only sorting
  if (!vnCount) return score;

  // IDF: log(total / count) - rarer tags get higher importance
  const importance = Math.log(totalVNs / Math.max(vnCount, 1));

  // Weight: score * importance (high score + rare tag = high weight)
  return score * importance;
}

/**
 * Sort tags by weighted score (highest first).
 * Works with tags that have either `rating` or `score` fields.
 * By default, filters out spoiler tags (spoiler > 0).
 *
 * @param tags - Array of tags to sort
 * @param filterSpoilers - Whether to filter out spoiler tags (default: true)
 * @returns New array sorted by weighted score descending
 */
export function sortTagsByWeight<
  T extends { rating?: number; score?: number; vn_count?: number; spoiler?: number }
>(tags: T[], filterSpoilers: boolean = true): T[] {
  const filtered = filterSpoilers
    ? tags.filter(t => !t.spoiler || t.spoiler === 0)
    : tags;
  return [...filtered].sort((a, b) => {
    const scoreA = a.rating ?? a.score ?? 0;
    const scoreB = b.rating ?? b.score ?? 0;
    const weightA = calculateTagWeight(scoreA, a.vn_count);
    const weightB = calculateTagWeight(scoreB, b.vn_count);
    return weightB - weightA;
  });
}
