'use client';

import { Languages } from 'lucide-react';

export type LanguageFilterValue = 'ja' | 'all';

interface LanguageFilterProps {
  value: LanguageFilterValue;
  onChange: (value: LanguageFilterValue) => void;
  className?: string;
}

/**
 * Toggle filter for showing Japanese-only VNs vs all VNs.
 * Defaults to Japanese-only since the site targets Japanese learners.
 */
export function LanguageFilter({ value, onChange, className = '' }: LanguageFilterProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <Languages className="w-4 h-4 text-gray-500 dark:text-gray-400" />
      <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
        <button
          onClick={() => onChange('ja')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            value === 'ja'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          Japanese
        </button>
        <button
          onClick={() => onChange('all')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            value === 'all'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          All
        </button>
      </div>
    </div>
  );
}

/**
 * Helper function to filter VNs by original language.
 * Returns true if the VN should be shown based on the filter.
 */
export function filterByLanguage<T extends { olang?: string }>(
  vn: T,
  filter: LanguageFilterValue
): boolean {
  if (filter === 'all') return true;
  return vn.olang === 'ja';
}
