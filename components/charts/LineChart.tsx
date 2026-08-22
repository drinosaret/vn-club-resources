'use client';

import { useId, useMemo, useRef, useState } from 'react';

import { useLabelBudget } from './use-label-budget';


import {
  areaPath,
  compactNumber,
  linePath,
  linearScale,
  niceTicks,
  spreadX,
  thinLabels,
} from '@/lib/chart-scales';

/**
 * A single-series line or area chart.
 *
 * The plot is drawn in percentage space inside a `viewBox` with
 * `preserveAspectRatio="none"`, so it fills whatever width it is given without measuring
 * anything. That keeps it SSR-safe and avoids the mount-time reflow a measuring chart
 * library causes.
 *
 * Anything that must not stretch with the non-uniform scale lives outside the SVG: axis
 * labels and the tooltip are ordinary positioned elements, and strokes inside the SVG use
 * `vectorEffect="non-scaling-stroke"`.
 */

export interface LinePoint {
  x: string;
  y: number;
}

interface LineChartProps {
  points: LinePoint[];
  color?: string;
  area?: boolean;
  height?: number;
  formatValue?: (value: number) => string;
  formatX?: (value: string) => string;
  valueSuffix?: string;
  /** Horizontal marker, for an average or threshold. */
  referenceValue?: number;
  referenceLabel?: string;
}

const MAX_X_LABELS = 6;
const Y_TICKS = 4;
/** Vertical room reserved for the x axis labels. */
const AXIS_HEIGHT = '1.25rem';
/** Horizontal room reserved for the y axis labels. */
const AXIS_WIDTH = '2.75rem';

export function LineChart({
  points,
  color = '#8b5cf6',
  area = true,
  height = 200,
  formatValue = compactNumber,
  formatX = (value) => value,
  valueSuffix,
  referenceValue,
  referenceLabel,
}: LineChartProps) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const labelBudget = useLabelBudget(plotRef, MAX_X_LABELS);

  const { values, scale, ticks, xs, xLabels } = useMemo(() => {
    const values = points.map((p) => p.y);
    const domain = referenceValue === undefined ? values : [...values, referenceValue];
    // Counts read wrong on a floating baseline: a series running 900 to 1000 would look
    // like it started from nothing.
    const scale = linearScale(domain, { zeroBased: true });
    return {
      values,
      scale,
      ticks: niceTicks(scale.min, scale.max, Y_TICKS),
      xs: spreadX(points.length),
      xLabels: thinLabels(points, labelBudget),
    };
  }, [points, referenceValue, labelBudget]);

  if (!points.length) return null;

  const hovered = hover === null ? null : points[hover];

  return (
    <div className="relative flex" style={{ height }}>
      {/* Labels are positioned against the plot area, not the whole box, so they line up
          with the gridlines once the x axis strip is subtracted. */}
      <div className="shrink-0 relative" style={{ width: AXIS_WIDTH }} aria-hidden="true">
        <div className="absolute inset-x-0 top-0" style={{ bottom: AXIS_HEIGHT }}>
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-1.5 text-[10px] leading-none text-gray-400 dark:text-gray-500 tabular-nums -translate-y-1/2"
              style={{ top: `${(1 - scale.norm(tick)) * 100}%` }}
            >
              {formatValue(tick)}
            </span>
          ))}
        </div>
      </div>

      <div ref={plotRef} className="flex-1 relative min-w-0">
        <div className="absolute inset-x-0 top-0" style={{ bottom: AXIS_HEIGHT }}>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="w-full h-full"
            role="img"
            aria-label="Trend chart"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>

            {ticks.map((tick) => {
              const y = (1 - scale.norm(tick)) * 100;
              return (
                <line
                  key={tick}
                  x1="0"
                  x2="100"
                  y1={y}
                  y2={y}
                  className="stroke-gray-200 dark:stroke-gray-700"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {referenceValue !== undefined ? (
              <line
                x1="0"
                x2="100"
                y1={(1 - scale.norm(referenceValue)) * 100}
                y2={(1 - scale.norm(referenceValue)) * 100}
                stroke={color}
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.5}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}

            {area ? <path d={areaPath(values, scale)} fill={`url(#${gradientId})`} /> : null}

            <path
              d={linePath(values, scale)}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {hover !== null ? (
            <span
              className="absolute w-2 h-2 rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none ring-2 ring-white dark:ring-gray-800"
              style={{
                left: `${xs[hover]}%`,
                top: `${(1 - scale.norm(values[hover])) * 100}%`,
                backgroundColor: color,
              }}
            />
          ) : null}

          {/* Full-height hit targets, so a value can be read without hitting the line. */}
          <div className="absolute inset-0 flex" onMouseLeave={() => setHover(null)}>
            {points.map((point, i) => (
              <button
                key={`${point.x}-${i}`}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="flex-1 h-full focus:outline-hidden"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            ))}
          </div>

          {hovered ? (
            <div
              className="absolute top-0 z-10 pointer-events-none bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700"
              style={{
                left: `${xs[hover!]}%`,
                // Nudged inward at the extremes so the card cannot overflow the plot.
                transform:
                  xs[hover!] > 70
                    ? 'translateX(-100%)'
                    : xs[hover!] < 30
                      ? 'none'
                      : 'translateX(-50%)',
              }}
            >
              <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {formatX(hovered.x)}
              </p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                {formatValue(hovered.y)}
                {valueSuffix ? (
                  <span className="text-gray-500 dark:text-gray-400 font-normal">
                    {' '}
                    {valueSuffix}
                  </span>
                ) : null}
              </p>
            </div>
          ) : null}

          {referenceLabel && referenceValue !== undefined ? (
            <span
              className="absolute right-0 text-[10px] text-gray-400 dark:text-gray-500 -translate-y-full pointer-events-none"
              style={{ top: `${(1 - scale.norm(referenceValue)) * 100}%` }}
            >
              {referenceLabel}
            </span>
          ) : null}
        </div>

        <div className="absolute inset-x-0 bottom-0" style={{ height: AXIS_HEIGHT }}>
          {xLabels.map(({ item, index }) => (
            <span
              key={`${item.x}-${index}`}
              className="absolute text-[10px] leading-none text-gray-400 dark:text-gray-500 whitespace-nowrap"
              style={{
                left: `${xs[index]}%`,
                // Ends align to their edge instead of centring, which would clip them.
                transform:
                  index === 0
                    ? 'none'
                    : index === points.length - 1
                      ? 'translateX(-100%)'
                      : 'translateX(-50%)',
              }}
            >
              {formatX(item.x)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
