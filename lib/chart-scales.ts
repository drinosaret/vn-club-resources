/**
 * Scale and path maths for the SVG chart kit.
 *
 * Pure functions with no React and no DOM, so they can be reasoned about and tested on
 * their own. Charts built on these size themselves with percentage coordinates inside a
 * `viewBox`, which means no measurement pass, no ResizeObserver, and no layout shift when
 * a chart mounts.
 */

export interface LinearScale {
  min: number;
  max: number;
  /** Map a value onto 0-1, clamped to the domain. */
  norm(value: number): number;
}

/**
 * Build a scale over a value range.
 *
 * A zero-width domain would divide by zero, so a flat series is placed at the midpoint
 * rather than collapsing to a single edge.
 */
export function linearScale(values: number[], opts?: { zeroBased?: boolean }): LinearScale {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) {
    return { min: 0, max: 1, norm: () => 0 };
  }

  let min = opts?.zeroBased ? Math.min(0, ...finite) : Math.min(...finite);
  let max = Math.max(...finite);

  if (min === max) {
    min = min - 1;
    max = max + 1;
  }

  const span = max - min;
  return {
    min,
    max,
    norm: (value: number) => {
      if (!Number.isFinite(value)) return 0;
      return Math.min(1, Math.max(0, (value - min) / span));
    },
  };
}

/**
 * Choose axis ticks that land on readable numbers.
 *
 * Picking evenly spaced values off the raw domain gives labels like 3.7143; stepping by a
 * 1, 2 or 5 times a power of ten keeps them legible at any magnitude.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min];
  }

  const rawStep = (max - min) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;

  // 2.5 belongs on the ladder: without it a 0-100 axis asked for four intervals jumps
  // from a step of 20 to a step of 50 and returns three ticks instead of five.
  let step: number;
  if (normalized <= 1) step = magnitude;
  else if (normalized <= 2) step = 2 * magnitude;
  else if (normalized <= 2.5) step = 2.5 * magnitude;
  else if (normalized <= 5) step = 5 * magnitude;
  else step = 10 * magnitude;

  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  // Nudged by a fraction of a step so floating point cannot drop the final tick.
  for (let value = start; value <= max + step * 0.001; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

/** Evenly spaced band centres across 0-100, one per item. */
export function bandCentres(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [50];
  const width = 100 / count;
  return Array.from({ length: count }, (_, i) => width * i + width / 2);
}

/** X positions across 0-100 for a series plotted at its endpoints. */
export function spreadX(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [50];
  return Array.from({ length: count }, (_, i) => (i / (count - 1)) * 100);
}

/**
 * Build an SVG polyline path through points given in percentage space.
 *
 * Y is inverted because SVG measures downward from the top while a chart reads upward
 * from its baseline.
 */
export function linePath(values: number[], scale: LinearScale): string {
  if (!values.length) return '';
  const xs = spreadX(values.length);
  return values
    .map((value, i) => {
      const y = 100 - scale.norm(value) * 100;
      return `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(3)},${y.toFixed(3)}`;
    })
    .join(' ');
}

/** The same path closed down to the baseline, for a filled area. */
export function areaPath(values: number[], scale: LinearScale): string {
  if (!values.length) return '';
  const xs = spreadX(values.length);
  const line = linePath(values, scale);
  return `${line} L${xs[xs.length - 1].toFixed(3)},100 L${xs[0].toFixed(3)},100 Z`;
}

/** Running totals, for the cumulative view of a series. */
export function cumulative(values: number[]): number[] {
  let total = 0;
  return values.map((value) => {
    total += Number.isFinite(value) ? value : 0;
    return total;
  });
}

/**
 * Format a number compactly enough for an axis label.
 *
 * Axis room is fixed, so a five-figure count has to shorten or it collides with the plot.
 */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (!Number.isInteger(value)) return value.toFixed(1);
  return String(value);
}

/** YYYY-MM into a short label, the form every trend series on the site uses. */
export function formatMonthLabel(month: string): string {
  if (!month || month.length < 7) return month;
  const [year, monthNum] = month.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(monthNum, 10) - 1] || monthNum} '${year.slice(-2)}`;
}

/**
 * Thin a list of labels down to at most `max`, always keeping the first and last.
 *
 * Dense series would otherwise overprint their own axis; the ends are kept because a
 * reader needs to know the range even when the middle is elided.
 *
 * The stride rarely divides the series exactly, so the last label it lands on is short of
 * the end by less than one stride. Adding the true end on top of it puts two labels closer
 * together than the stride was chosen to allow, and at the width these axes get that reads
 * as one smudged number. The straggler gives way to the end instead: one wider gap costs
 * less than two labels printed over each other.
 */
export function thinLabels<T>(items: T[], max: number): { item: T; index: number }[] {
  if (items.length <= max) {
    return items.map((item, index) => ({ item, index }));
  }
  const stride = Math.ceil(items.length / max);
  const kept: { item: T; index: number }[] = [];
  for (let i = 0; i < items.length; i += stride) {
    kept.push({ item: items[i], index: i });
  }
  const lastIndex = items.length - 1;
  const last = kept[kept.length - 1];
  if (last.index !== lastIndex) {
    if (kept.length > 1) {
      kept.pop();
    }
    kept.push({ item: items[lastIndex], index: lastIndex });
  }
  return kept;
}
