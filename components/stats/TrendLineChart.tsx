'use client';

import { useMemo } from 'react';

import { ChartFrame } from '@/components/charts/ChartFrame';
import { LineChart } from '@/components/charts/LineChart';
import { cumulative, formatMonthLabel } from '@/lib/chart-scales';

/**
 * Trend chart used by the user stats and VN stats tabs.
 *
 * Callers pass rows plus the keys to read, so the props stay independent of the renderer
 * underneath and callers need not shape their data for it.
 */

interface TrendLineChartProps<T> {
  data: T[];
  dataKey: keyof T;
  xAxisKey: keyof T;
  title: string;
  subtitle?: string;
  color?: string;
  areaFill?: boolean;
  yAxisLabel?: string;
  formatValue?: (value: number) => string;
  formatXAxis?: (value: string) => string;
  height?: number;
  cumulative?: boolean;
  headerRight?: React.ReactNode;
  referenceValue?: number;
  referenceLabel?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function TrendLineChart<T extends Record<string, any>>({
  data,
  dataKey,
  xAxisKey,
  title,
  subtitle,
  color = '#8b5cf6',
  areaFill = true,
  yAxisLabel,
  formatValue = (v) => v.toLocaleString(),
  formatXAxis,
  height = 200,
  cumulative: isCumulative = false,
  headerRight,
  referenceValue,
  referenceLabel,
}: TrendLineChartProps<T>) {
  const points = useMemo(() => {
    const xs = data.map((item) => String(item[xAxisKey] ?? ''));
    const raw = data.map((item) => Number(item[dataKey]) || 0);
    const ys = isCumulative ? cumulative(raw) : raw;
    return xs.map((x, i) => ({ x, y: ys[i] }));
  }, [data, dataKey, xAxisKey, isCumulative]);

  const formatX = formatXAxis ?? formatMonthLabel;

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      headerRight={headerRight}
      height={height}
      empty={!data || data.length === 0}
    >
      <LineChart
        points={points}
        color={color}
        area={areaFill}
        height={height}
        formatValue={formatValue}
        formatX={formatX}
        valueSuffix={yAxisLabel}
        referenceValue={referenceValue}
        referenceLabel={referenceLabel}
      />
    </ChartFrame>
  );
}
