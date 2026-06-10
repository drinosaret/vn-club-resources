import type { HigherLowerPoolVN } from '@/lib/vndb-stats-api';

export type MetricKey = 'votes' | 'rating' | 'year';

export interface MetricDef {
  key: MetricKey;
  label: string; // mode-toggle label
  unit: string; // small grey unit shown next to the value ('' = none)
  caption: string; // hint above the guess buttons
  value: (vn: HigherLowerPoolVN) => number;
  format: (v: number) => string;
  // Count-up suits big integers (votes); small numbers (rating, year) reveal instantly.
  animate: boolean;
}

export const METRIC_ORDER: MetricKey[] = ['votes', 'rating', 'year'];

export const METRICS: Record<MetricKey, MetricDef> = {
  votes: {
    key: 'votes',
    label: 'Votes',
    unit: 'votes',
    caption: 'more or fewer votes?',
    value: (vn) => vn.votecount,
    format: (v) => v.toLocaleString(),
    animate: true,
  },
  rating: {
    key: 'rating',
    label: 'Rating',
    unit: 'rating',
    caption: 'higher or lower rating?',
    value: (vn) => vn.rating ?? 0,
    format: (v) => v.toFixed(2),
    animate: false,
  },
  year: {
    key: 'year',
    label: 'Year',
    unit: '',
    caption: 'newer or older?',
    value: (vn) => vn.year ?? 0,
    format: (v) => String(v),
    animate: false,
  },
};
