/**
 * Ranking metrics offered as sort orders on /browse.
 *
 * Mirrors `app/leaderboards/browse_metrics.py`. The backend owns the arithmetic and the
 * sample floors; this file owns only the labels and how a value is written out, which is
 * why the floor text arrives on the response rather than being repeated here. A number that
 * appeared in both places would eventually be right in one of them.
 */

export const BROWSE_METRICS = [
  'divisiveness',
  'reputation',
  'rising_month',
  'rising_year',
  'drop_rate',
  'completion_rate',
  'wishlist',
  'difficulty',
] as const;

export type BrowseMetric = (typeof BROWSE_METRICS)[number];

export const PLAIN_SORTS = ['rating', 'released', 'votecount', 'title', 'random'] as const;

export type BrowseSort = (typeof PLAIN_SORTS)[number] | BrowseMetric;

export function isBrowseMetric(sort: string | null | undefined): sort is BrowseMetric {
  return !!sort && (BROWSE_METRICS as readonly string[]).includes(sort);
}

/** How each metric's value is written out beside a title. */
type Formatter = (value: number) => string;

const asPercent: Formatter = (value) => `${Math.round(value * 100)}%`;
const asCount: Formatter = (value) => Math.round(value).toLocaleString();
/** Rating points, signed: the sign is the whole point of a shift. */
const asSignedPoints: Formatter = (value) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}`;
/** A spread, which has no direction, so it is written with the plus-or-minus sign. */
const asSpread: Formatter = (value) => `±${value.toFixed(2)}`;
/** Difficulty, on the upstream's own scale rather than rescaled to a percentage. */
const asDifficulty: Formatter = (value) => value.toFixed(2);

interface MetricDisplay {
  label: string;
  /** Shown under the sort control, so the reader knows what the ordering means. */
  blurb: string;
  format: Formatter;
}

export const METRIC_DISPLAY: Record<BrowseMetric, MetricDisplay> = {
  divisiveness: {
    label: 'Divisiveness',
    blurb: 'How far apart its votes are, rather than where they average out.',
    format: asSpread,
  },
  reputation: {
    label: 'Reputation shift',
    blurb: 'How far its rating moved between its earlier and later votes.',
    format: asSignedPoints,
  },
  rising_month: {
    label: 'Rising this month',
    blurb: 'Share of its lifetime votes cast in the last 30 days.',
    format: asPercent,
  },
  rising_year: {
    label: 'Rising this year',
    blurb: 'Share of its lifetime votes cast in the last year.',
    format: asPercent,
  },
  drop_rate: {
    label: 'Drop rate',
    blurb: 'Share of readers who started it and gave up.',
    format: asPercent,
  },
  completion_rate: {
    label: 'Completion rate',
    blurb: 'Share of readers who started it and finished.',
    format: asPercent,
  },
  wishlist: {
    label: 'Wishlisted',
    blurb: 'How many people have it on their wishlist.',
    format: asCount,
  },
  difficulty: {
    label: 'Reading difficulty',
    blurb: 'How hard the Japanese is, from jiten.moe’s analysis of the script.',
    format: asDifficulty,
  },
};

/** Formats a metric value for display, or returns null when there is nothing to show. */
export function formatMetricValue(
  metric: string | null | undefined,
  value: number | null | undefined,
): string | null {
  if (!isBrowseMetric(metric) || value === null || value === undefined) return null;
  return METRIC_DISPLAY[metric].format(value);
}
