'use client';

import { useMemo, useState } from 'react';


import { compactNumber } from '@/lib/chart-scales';

/**
 * A labelled bar chart for a small, fixed set of categories.
 *
 * Deliberately narrower than the distribution charts under components/stats: those carry
 * per-bar deep links into browse, secondary axes and touch semantics built up over time.
 * This is for the cases where none of that applies and a category just needs a bar.
 *
 * Bars are sized by percentage height, so nothing is measured and nothing shifts on mount.
 */

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Overrides the shared colour for a single bar, to mark a peak or a selection. */
  color?: string;
}

interface SimpleBarChartProps {
  data: BarDatum[];
  height?: number;
  color?: string;
  formatValue?: (value: number) => string;
  /** Emphasise the largest bar, which is usually the point of the chart. */
  highlightMax?: boolean;
  /**
   * A reference value drawn across the chart, with its own label.
   *
   * For a set of shares that must add up to one, the interesting thing is which categories
   * sit above and below the line. Without it the bars are all a similar height and the
   * reader is left to compare them by eye.
   *
   * Label it as the thing it represents rather than as the calculation behind it: "average
   * month" lands where "even split" makes the reader stop and work out what was split.
   */
  baseline?: { value: number; label: string };
}

export function SimpleBarChart({
  data,
  height = 160,
  color = 'var(--color-primary-500, #6366f1)',
  formatValue = compactNumber,
  highlightMax = false,
  baseline,
}: SimpleBarChartProps) {
  const [hover, setHover] = useState<string | null>(null);

  const { max, peak } = useMemo(() => {
    const values = data.map((d) => d.value);
    const highest = Math.max(...values, baseline?.value ?? 0);
    return {
      // Scaled to the data, with a little headroom so the tallest bar is not flush against
      // the top. A fixed floor would pin a chart of fractional shares to a 0-to-1 axis and
      // draw every bar as an identical sliver.
      //
      // Bars still start at zero. A chart of shares that cropped the axis would exaggerate
      // small differences into large ones, which is the opposite problem.
      max: highest > 0 ? highest * 1.12 : 1,
      peak: values.length ? data[values.indexOf(Math.max(...values))].key : null,
    };
  }, [data, baseline]);

  if (!data.length) return null;

  // The baseline label is opaque and sits at one end of the line. Pinned to a fixed side it
  // lands on whichever bar happens to be there, which in these charts is usually the tallest
  // one: the label then covers the bar it exists to be compared against. It goes to the end
  // with the shorter bar, where there is room above it.
  const labelSide =
    data[data.length - 1].value > data[0].value ? 'left-0' : 'right-0';

  return (
    <div>
      <div
        className="relative flex items-end gap-1"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
      >
        {baseline && baseline.value > 0 && (
          <div
            className="absolute inset-x-0 z-10 pointer-events-none border-t border-dashed border-gray-400/70 dark:border-gray-500/70"
            style={{ bottom: `${(baseline.value / max) * 100}%` }}
            title={`${baseline.label}: ${formatValue(baseline.value)}`}
          >
            <span
              className={`absolute ${labelSide} -top-1.5 text-[10px] leading-none text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 px-1 rounded-sm`}
            >
              {baseline.label}
            </span>
          </div>
        )}

        {data.map((datum) => {
          const emphasised = highlightMax && datum.key === peak;
          const active = hover === datum.key;
          return (
            <button
              key={datum.key}
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="flex-1 min-w-0 h-full flex flex-col justify-end group focus:outline-hidden"
              onMouseEnter={() => setHover(datum.key)}
              onFocus={() => setHover(datum.key)}
              onBlur={() => setHover(null)}
              aria-label={`${datum.label}: ${formatValue(datum.value)}`}
            >
              <span
                className={`block text-[10px] leading-none text-center mb-1 tabular-nums transition-opacity ${
                  active ? 'opacity-100' : 'opacity-0'
                } text-gray-600 dark:text-gray-300`}
              >
                {formatValue(datum.value)}
              </span>
              <span
                className="block w-full rounded-t-sm transition-opacity"
                style={{
                  height: `${(datum.value / max) * 100}%`,
                  backgroundColor: datum.color ?? color,
                  opacity: active ? 1 : emphasised ? 0.95 : 0.65,
                }}
              />
            </button>
          );
        })}
      </div>

      <div className="flex gap-1 mt-1.5">
        {data.map((datum) => (
          <span
            key={datum.key}
            className="flex-1 text-[10px] leading-none text-center text-gray-400 dark:text-gray-500 truncate"
          >
            {datum.label}
          </span>
        ))}
      </div>
    </div>
  );
}
