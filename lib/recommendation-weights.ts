/**
 * Signal weights used by the recommendation match score.
 *
 * These mirror SIGNAL_WEIGHTS in the backend recommender
 * (vndb-stats-backend/app/services/hybrid_recommender.py). The backend is authoritative:
 * it computes the `normalized_score` shown on cards, while this table only drives the
 * client-side breakdown of how much each signal contributed. If the two disagree, a
 * recommendation's stated reasons will not add up to its displayed percentage.
 *
 * Keys match the `scores` object returned per recommendation.
 */
export const SIGNAL_WEIGHTS = {
  tag: 2.5,
  similar_games: 2.0,
  users_also_read: 2.0,
  quality: 1.5,
  developer: 0.6,
  staff: 0.5,
  trait: 0.5,
  seiyuu: 0.3,
} as const;

export type SignalKey = keyof typeof SIGNAL_WEIGHTS;

/** Score a VN would reach with every signal maxed out. Derived, never written down. */
export const MAX_RAW_SCORE = Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0);

/** A signal's share of the total if every signal scored perfectly. */
export function maxContributionPct(weight: number): number {
  return Math.round((weight / MAX_RAW_SCORE) * 100);
}
