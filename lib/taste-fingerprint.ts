/**
 * Reduces a reader's stats to six comparable axes.
 *
 * Everything here is derived from data the stats page has already fetched, so the
 * fingerprint costs no request and no backend work.
 *
 * Each axis is a self-contained ratio scaled to 0-100 rather than a comparison against the
 * population. That is a deliberate constraint: a population reference would be a number
 * baked into the client that drifts as the database grows, and the axes would quietly start
 * lying. A position on its own scale stays true.
 *
 * Every axis carries two sentences beside its number. `detail` states what the reader's own
 * score amounts to, and `formula` says how it was worked out. Neither describes what a
 * perfect score would mean: a fixed sentence like "most of what you read is recent" sits
 * just as happily under a 12 as under an 88, and reads as a claim about the reader either
 * way. Five of the six are a share of something, so their detail can simply say what share
 * it is, which is true at every value.
 */

/**
 * Axis names are dimensions rather than descriptions of a high score.
 *
 * "Generous" and "Wide taste" read as claims about the reader, which is wrong at every value
 * but the top: a score of 12 labelled "Generous" says the opposite of what it means. A
 * dimension name is true at both ends, and the reader's own figure is written out beside it.
 */
export interface FingerprintAxis {
  key: string;
  label: string;
  /** 0-100. */
  value: number;
  /** What this reader's own score amounts to, in the underlying quantity. */
  detail: string;
  /** The rule the number follows. */
  formula: string;
  /**
   * The same rule with this reader's own figures in it.
   *
   * Four of the six axes are a plain share and read the same either way, but the other two
   * do not: a rating average of 5.24 becoming 47, or a strongest tag of 6% becoming 94, is
   * unguessable from a description. Every figure printed here is the one shown elsewhere on
   * the card, and the scores are derived from those same rounded figures, so the arithmetic
   * on screen always reconciles rather than landing a point off.
   */
  working: string;
  /** Null when the underlying data is absent, so the axis can be omitted honestly. */
  available: boolean;
}

export interface FingerprintInput {
  averageScore: number | null;
  completed: number;
  totalOnList: number;
  /** Release year to count of titles read. */
  releaseYears: Record<string, number>;
  /** Length bucket name to count. */
  lengths: Record<string, number>;
  /** Age bucket name to count. */
  ageRatings: Record<string, number>;
  /** Weighted scores of the reader's strongest tags, largest first. */
  topTagWeights: number[];
  /** Reference year for "recent", passed in so the calculation stays deterministic. */
  currentYear: number;
}

/** How many years back still counts as modern. */
const MODERN_WINDOW_YEARS = 10;

/** Length buckets treated as a long commitment. */
const LONG_BUCKETS = ['long', 'very_long'];

/** Age buckets treated as adult. */
const ADULT_BUCKETS = ['adult'];

/** Tags considered when measuring breadth. */
const BREADTH_TAG_COUNT = 20;

interface Share {
  /** 0-100. */
  percent: number;
  matching: number;
  total: number;
}

function shareOf(
  counts: Record<string, number>,
  predicate: (key: string) => boolean,
): Share | null {
  const entries = Object.entries(counts ?? {});
  const total = entries.reduce((sum, [, value]) => sum + (value || 0), 0);
  if (!total) return null;
  const matching = entries.reduce(
    (sum, [key, value]) => (predicate(key) ? sum + (value || 0) : sum),
    0,
  );
  return { percent: (matching / total) * 100, matching, total };
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));

/** The working for an axis that is a plain share of something. */
const shareWorking = (matching: number, total: number) =>
  `${count(matching)} ÷ ${count(total)} × 100 = ${Math.round((matching / total) * 100)}`;

const pct = (value: number) => `${Math.round(value)}%`;
const count = (value: number) => value.toLocaleString();

export function computeFingerprint(input: FingerprintInput): FingerprintAxis[] {
  const oldest = input.currentYear - MODERN_WINDOW_YEARS;

  // Position on the 1-10 rating scale, not a comparison: "generous" here means rates
  // highly, which is a property of the reader rather than of the population.
  const rawAverage = input.averageScore && input.averageScore > 0 ? input.averageScore : null;
  // Rounded before the score is taken from it, not after: the card prints the average to two
  // places, and a score derived from more precision than that would not match its own working.
  const average = rawAverage === null ? null : Number(rawAverage.toFixed(2));
  const generosity = average === null ? null : clamp(((average - 1) / 9) * 100);

  const modern = shareOf(input.releaseYears, (year) => {
    const parsed = Number(year);
    return Number.isFinite(parsed) && parsed >= oldest;
  });
  const long = shareOf(input.lengths, (bucket) => LONG_BUCKETS.includes(bucket));
  const adult = shareOf(input.ageRatings, (bucket) => ADULT_BUCKETS.includes(bucket));

  const finished =
    input.totalOnList > 0 ? clamp((input.completed / input.totalOnList) * 100) : null;

  // Breadth as the inverse of concentration. A reader whose top tag dominates their profile
  // has narrow taste; one whose strongest tags are level has wide taste.
  const weights = input.topTagWeights.slice(0, BREADTH_TAG_COUNT).filter((w) => w > 0);
  const weightTotal = weights.reduce((sum, w) => sum + w, 0);
  const topShare = weights.length > 1 && weightTotal > 0 ? weights[0] / weightTotal : null;
  const range = topShare === null ? null : clamp((1 - topShare) * 100);
  // Taken back off the score rather than rounded from the share independently: rounding the
  // two ends separately lets them sum to 99 or 101 in front of the reader.
  const topSharePercent = range === null ? null : 100 - Math.round(range);

  // Value is nullable while the axes are assembled; an axis with no data is kept so the
  // caller can say it is missing rather than silently dropping to zero.
  interface Draft {
    key: string;
    label: string;
    value: number | null;
    detail: string;
    formula: string;
    working: string;
  }

  const axes: Draft[] = [
    {
      key: 'generosity',
      label: 'Generosity',
      value: generosity,
      detail:
        average === null
          ? ''
          : `Your ratings average ${average.toFixed(2)} out of 10.`,
      formula:
        'Where your average rating sits on the 1 to 10 scale: a 1 scores 0, a 10 scores 100.',
      working:
        average === null
          ? ''
          : `(${average.toFixed(2)} − 1) ÷ 9 × 100 = ${Math.round(generosity ?? 0)}`,
    },
    {
      key: 'modernity',
      label: 'Recency',
      value: modern?.percent ?? null,
      detail: modern
        ? `${pct(modern.percent)} of your titles came out in ${oldest} or later, ${count(modern.matching)} of ${count(modern.total)}.`
        : '',
      formula: `The share of your titles released within the last ${MODERN_WINDOW_YEARS} years.`,
      working: modern ? shareWorking(modern.matching, modern.total) : '',
    },
    {
      key: 'endurance',
      label: 'Length',
      value: long?.percent ?? null,
      detail: long
        ? `${pct(long.percent)} of your titles are long or very long, ${count(long.matching)} of ${count(long.total)}.`
        : '',
      formula: "The share of your titles in VNDB's long and very long buckets.",
      working: long ? shareWorking(long.matching, long.total) : '',
    },
    {
      key: 'maturity',
      label: 'Adult content',
      value: adult?.percent ?? null,
      detail: adult
        ? `${pct(adult.percent)} of your titles are adult-rated, ${count(adult.matching)} of ${count(adult.total)}.`
        : '',
      formula: 'The share of your titles rated 18+.',
      working: adult ? shareWorking(adult.matching, adult.total) : '',
    },
    {
      key: 'followThrough',
      label: 'Completion',
      value: finished,
      detail:
        finished === null
          ? ''
          : `You have finished ${pct(finished)} of your list, ${count(input.completed)} of ${count(input.totalOnList)}.`,
      formula: 'Titles you have marked finished, over everything on your list.',
      working: finished === null ? '' : shareWorking(input.completed, input.totalOnList),
    },
    {
      key: 'range',
      label: 'Taste width',
      value: range,
      detail:
        topSharePercent === null
          ? ''
          : `Your single strongest tag accounts for ${topSharePercent}% of your top ${weights.length}.`,
      formula:
        `A hundred minus the share your strongest tag takes of your top ${weights.length} tags.`,
      working:
        topSharePercent === null
          ? ''
          : `100 − ${topSharePercent} = ${Math.round(range ?? 0)}`,
    },
  ];

  return axes.map((axis) => ({
    ...axis,
    value: axis.value ?? 0,
    available: axis.value !== null,
  }));
}

/**
 * A short phrase summarising the shape, for the caption.
 *
 * Names the two strongest available axes, which is what someone would say about the chart
 * if asked to describe it in a sentence.
 */
export function describeFingerprint(axes: FingerprintAxis[]): string {
  const ranked = axes.filter((a) => a.available).sort((a, b) => b.value - a.value);
  if (ranked.length < 2) return '';
  return `Strongest on ${ranked[0].label.toLowerCase()} and ${ranked[1].label.toLowerCase()}.`;
}
