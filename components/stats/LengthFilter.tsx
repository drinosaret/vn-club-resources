'use client';

import { Clock } from 'lucide-react';

export type LengthFilterValue = 'any' | 'very_short' | 'short' | 'medium' | 'long' | 'very_long';

const LENGTH_OPTIONS: { value: LengthFilterValue; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'very_short', label: 'Very Short' },
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
  { value: 'very_long', label: 'Very Long' },
];

interface LengthFilterProps {
  value: LengthFilterValue;
  onChange: (value: LengthFilterValue) => void;
  className?: string;
}

export function LengthFilter({ value, onChange, className = '' }: LengthFilterProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <Clock className="w-4 h-4 text-gray-500 dark:text-gray-400" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LengthFilterValue)}
        className="text-xs font-medium px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-0 focus:ring-2 focus:ring-primary-500 cursor-pointer"
      >
        {LENGTH_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function filterByLength<T extends { length?: number }>(
  vn: T,
  filter: LengthFilterValue
): boolean {
  if (filter === 'any') return true;
  if (!vn.length) return false;

  const lengthMap: Record<LengthFilterValue, number> = {
    any: 0,
    very_short: 1,
    short: 2,
    medium: 3,
    long: 4,
    very_long: 5,
  };

  return vn.length === lengthMap[filter];
}
