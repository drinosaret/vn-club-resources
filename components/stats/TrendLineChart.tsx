'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  TooltipProps,
} from 'recharts';

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
}

export function TrendLineChart<T extends Record<string, unknown>>({
  data,
  dataKey,
  xAxisKey,
  title,
  subtitle,
  color = '#8b5cf6',
  areaFill = true,
  yAxisLabel,
  formatValue = (v) => v.toLocaleString(),
  formatXAxis = (v) => v,
  height = 200,
  cumulative = false,
}: TrendLineChartProps<T>) {
  // Process data for cumulative if needed
  const chartData = useMemo(() => {
    if (!cumulative) return data;

    let total = 0;
    return data.map((item) => {
      const value = item[dataKey] as number;
      total += value || 0;
      return { ...item, [dataKey]: total };
    });
  }, [data, dataKey, cumulative]);

  // Custom tooltip
  const CustomTooltip = (props: TooltipProps<number, string>) => {
    const { active, payload, label } = props as { active?: boolean; payload?: Array<{ value?: number }>; label?: string };
    if (!active || !payload || !payload.length) return null;

    const value = payload[0].value as number;
    return (
      <div className="bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <p className="text-xs text-gray-500 dark:text-gray-400">{formatXAxis(label || '')}</p>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {formatValue(value)}
          {yAxisLabel && <span className="text-gray-500 dark:text-gray-400 font-normal"> {yAxisLabel}</span>}
        </p>
      </div>
    );
  };

  // Format month for display (YYYY-MM -> MMM 'YY)
  const formatMonth = (month: string) => {
    if (!month || month.length < 7) return month;
    const [year, monthNum] = month.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = monthNames[parseInt(monthNum, 10) - 1] || monthNum;
    return `${monthName} '${year.slice(-2)}`;
  };

  const xAxisFormatter = formatXAxis || formatMonth;

  if (!data || data.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-4">{title}</h3>
        <div className="h-48 flex items-center justify-center text-gray-400 dark:text-gray-500">
          No data available
        </div>
      </div>
    );
  }

  const ChartComponent = areaFill ? AreaChart : LineChart;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="mb-4 pr-24">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">{title}</h3>
        {subtitle && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ChartComponent data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id={`gradient-${dataKey as string}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
          <XAxis
            dataKey={xAxisKey as string}
            tickFormatter={xAxisFormatter}
            tick={{ fontSize: 11 }}
            className="text-gray-500 dark:text-gray-400"
            axisLine={{ className: 'stroke-gray-200 dark:stroke-gray-700' }}
            tickLine={{ className: 'stroke-gray-200 dark:stroke-gray-700' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11 }}
            className="text-gray-500 dark:text-gray-400"
            axisLine={{ className: 'stroke-gray-200 dark:stroke-gray-700' }}
            tickLine={{ className: 'stroke-gray-200 dark:stroke-gray-700' }}
            tickFormatter={(v) => formatValue(v)}
            width={50}
          />
          <Tooltip content={<CustomTooltip />} />
          {areaFill ? (
            <Area
              type="monotone"
              dataKey={dataKey as string}
              stroke={color}
              strokeWidth={2}
              fill={`url(#gradient-${dataKey as string})`}
              dot={false}
              activeDot={{ r: 4, fill: color }}
            />
          ) : (
            <Line
              type="monotone"
              dataKey={dataKey as string}
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: color }}
            />
          )}
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  );
}
