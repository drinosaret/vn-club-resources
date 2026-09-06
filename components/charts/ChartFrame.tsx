'use client';

import type { ReactNode } from 'react';

import { ChartData } from '@/components/charts/ChartData';

/**
 * The card every chart sits in.
 *
 * Charts render their plot and nothing else; this owns the box around it, so spacing, the
 * heading and the dark-mode treatment are defined once for all of them.
 */

interface ChartFrameProps {
  title: string;
  subtitle?: string;
  /** Slot for a toggle or filter aligned with the title. */
  headerRight?: ReactNode;
  footer?: ReactNode;
  /** Shown instead of the children when there is nothing to plot. */
  empty?: boolean;
  emptyMessage?: string;
  height?: number;
  className?: string;
  children: ReactNode;
  /**
   * The plotted values, offered as an openable table under the chart.
   *
   * Rendered here rather than inside the chart because a chart owns a positioned, fixed-height
   * plot area, and anything else placed in it lands on top of the drawing.
   */
  data?: { caption: string; columns: string[]; rows: string[][] };
}

export function ChartFrame({
  title,
  subtitle,
  headerRight,
  footer,
  empty = false,
  emptyMessage = 'No data available',
  height = 200,
  className = '',
  children,
  data,
}: ChartFrameProps) {
  return (
    <div
      className={`sw-panel p-5 ${className}`}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="sw-card-title">{title}</h3>
          {subtitle ? (
            <p className="sw-pick-desc mt-0.5">{subtitle}</p>
          ) : null}
        </div>
        {headerRight}
      </div>

      {empty ? (
        <div
          className="flex items-center justify-center text-[color:var(--text-faint)] text-sm"
          style={{ height }}
        >
          {emptyMessage}
        </div>
      ) : (
        children
      )}

      {!empty && data ? (
        <ChartData caption={data.caption} columns={data.columns} rows={data.rows} />
      ) : null}

      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}
