'use client';

import { useMemo, useRef, useState } from 'react';


import { compactNumber, niceTicks, spreadX, thinLabels } from '@/lib/chart-scales';
import { useLabelBudget } from './use-label-budget';

/**
 * Stacked composition over time: what a total was made of, year by year.
 *
 * Two modes. Absolute stacking shows the total growing, which is what "how much was
 * released" needs. Normalised stacking scales every column to full height, which is what
 * "what share was Japanese" needs, and is the only way to read the early years where the
 * absolute numbers are too small to see.
 */

export interface StackedPoint {
  /** Label for the column, typically a year. */
  x: string | number;
  /** Value per series key. Missing keys count as zero. */
  values: Record<string, number>;
}

interface StackedAreaChartProps {
  points: StackedPoint[];
  /** Series keys, drawn bottom to top in this order. */
  series: string[];
  colors: Record<string, string>;
  labels?: Record<string, string>;
  height?: number;
  normalized?: boolean;
  formatX?: (value: string) => string;
}

const MAX_X_LABELS = 8;
const AXIS_HEIGHT = '1.25rem';
const AXIS_WIDTH = '2.75rem';

export function StackedAreaChart({
  points,
  series,
  colors,
  labels = {},
  height = 240,
  normalized = false,
  formatX = (value) => value,
}: StackedAreaChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  /**
   * A value as the tooltip should read it.
   *
   * Normalised mode scales each column against its own total rather than being handed
   * shares, so a value is usually still a count and has to be divided before it can be read
   * as a percentage. The count is kept alongside, because a share of a year holding four
   * releases means something different from the same share of a year holding four hundred.
   *
   * Some callers do arrive with shares that already sum to one, and a denominator of "1"
   * would be worse than none. A column totalling one is treated as that case: a year holding
   * a single item loses only the denominator, and reads correctly either way.
   */
  const describe = (value: number, total: number) => {
    if (!normalized) return value.toLocaleString();
    const share = ((value / (total || 1)) * 100).toFixed(1);
    return Math.abs(total - 1) < 0.001 ? `${share}%` : `${share}% of ${total.toLocaleString()}`;
  };

  const plotRef = useRef<HTMLDivElement>(null);
  const labelBudget = useLabelBudget(plotRef, MAX_X_LABELS);

  const { columns, max, ticks, xs, xLabels } = useMemo(() => {
    const columns = points.map((point) => {
      const total = series.reduce((sum, key) => sum + (point.values[key] || 0), 0);
      return { point, total };
    });
    const max = normalized ? 1 : Math.max(1, ...columns.map((c) => c.total));
    return {
      columns,
      max,
      ticks: normalized ? [0, 0.25, 0.5, 0.75, 1] : niceTicks(0, max, 4),
      xs: spreadX(points.length),
      xLabels: thinLabels(points, labelBudget),
    };
  }, [points, series, normalized, labelBudget]);

  if (!points.length) return null;

  // Bars rather than smoothed bands: the data is one value per discrete year, and a
  // smoothed curve would invent intermediate values that were never measured.
  const columnWidth = 100 / points.length;

  return (
    <div>
      <div className="relative flex" style={{ height }}>
        <div className="shrink-0 relative" style={{ width: AXIS_WIDTH }} aria-hidden="true">
          <div className="absolute inset-x-0 top-0" style={{ bottom: AXIS_HEIGHT }}>
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute right-1.5 text-[10px] leading-none text-gray-400 dark:text-gray-500 tabular-nums -translate-y-1/2"
                style={{ top: `${(1 - tick / max) * 100}%` }}
              >
                {normalized ? `${Math.round(tick * 100)}%` : compactNumber(tick)}
              </span>
            ))}
          </div>
        </div>

        <div ref={plotRef} className="flex-1 relative min-w-0">
          <div
            className="absolute inset-x-0 top-0 flex items-end"
            style={{ bottom: AXIS_HEIGHT }}
            onMouseLeave={() => setHover(null)}
          >
            {columns.map(({ point, total }, i) => {
              const scale = normalized ? (total || 1) : max;
              return (
                <button
                  key={`${point.x}-${i}`}
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  className="relative h-full focus:outline-hidden group"
                  style={{ width: `${columnWidth}%` }}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                >
                  <span
                    className={`absolute inset-x-0 bottom-0 flex flex-col-reverse ${
                      hover === i ? 'opacity-100' : 'opacity-90'
                    }`}
                    style={{ height: `${(normalized ? 1 : total / max) * 100}%` }}
                  >
                    {series.map((key) => {
                      const value = point.values[key] || 0;
                      if (!value) return null;
                      return (
                        <span
                          key={key}
                          className="block w-full"
                          style={{
                            height: `${(value / scale) * 100}%`,
                            backgroundColor: colors[key] ?? '#94a3b8',
                          }}
                        />
                      );
                    })}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="absolute inset-x-0 bottom-0" style={{ height: AXIS_HEIGHT }}>
            {xLabels.map(({ item, index }) => (
              <span
                key={`${item.x}-${index}`}
                className="absolute text-[10px] leading-none text-gray-400 dark:text-gray-500 whitespace-nowrap"
                style={{
                  left: `${xs[index]}%`,
                  transform:
                    index === 0
                      ? 'none'
                      : index === points.length - 1
                        ? 'translateX(-100%)'
                        : 'translateX(-50%)',
                }}
              >
                {formatX(String(item.x))}
              </span>
            ))}
          </div>

          {hover !== null ? (
            <div
              className="absolute top-0 z-10 pointer-events-none bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-h-full overflow-hidden"
              style={{
                left: `${xs[hover]}%`,
                transform: xs[hover] > 60 ? 'translateX(-100%)' : 'none',
              }}
            >
              <p className="text-xs font-medium text-gray-900 dark:text-white mb-1 whitespace-nowrap">
                {formatX(String(points[hover].x))}
              </p>
              {series
                .map((key) => ({ key, value: points[hover].values[key] || 0 }))
                .filter((entry) => entry.value > 0)
                .sort((a, b) => b.value - a.value)
                .slice(0, 6)
                .map(({ key, value }) => (
                  <p
                    key={key}
                    className="text-[11px] text-gray-600 dark:text-gray-300 flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: colors[key] ?? '#94a3b8' }}
                    />
                    {labels[key] ?? key}
                    <span className="ml-auto tabular-nums font-medium">
                      {describe(value, columns[hover].total)}
                    </span>
                  </p>
                ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {series.map((key) => (
          <span
            key={key}
            className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400"
          >
            <span
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: colors[key] ?? '#94a3b8' }}
            />
            {labels[key] ?? key}
          </span>
        ))}
      </div>
    </div>
  );
}
