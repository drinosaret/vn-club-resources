'use client';

import { EyeOff } from 'lucide-react';

export type SpoilerFilterValue = 0 | 1 | 2;

const SPOILER_OPTIONS: { value: SpoilerFilterValue; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Minor' },
  { value: 2, label: 'Major' },
];

interface SpoilerFilterProps {
  value: SpoilerFilterValue;
  onChange: (value: SpoilerFilterValue) => void;
  className?: string;
}

export function SpoilerFilter({ value, onChange, className = '' }: SpoilerFilterProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <EyeOff className="w-4 h-4 text-gray-500 dark:text-gray-400" />
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as SpoilerFilterValue)}
        className="text-xs font-medium px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-0 focus:ring-2 focus:ring-primary-500 cursor-pointer"
      >
        {SPOILER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            Spoilers: {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
