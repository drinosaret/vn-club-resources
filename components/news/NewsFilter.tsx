'use client';

import { newsSources, type NewsSource } from '@/lib/sample-news-data';

interface NewsFilterProps {
  activeSource: NewsSource | 'all';
  onSourceChange: (source: NewsSource | 'all') => void;
}

export function NewsFilter({ activeSource, onSourceChange }: NewsFilterProps) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Filter news by source">
      {newsSources.map((source) => {
        const isActive = activeSource === source.id;
        return (
          <button
            key={source.id}
            onClick={() => onSourceChange(source.id)}
            role="radio"
            aria-checked={isActive}
            className={`
              px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
              ${isActive
                ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200 ring-2 ring-rose-500/50'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }
            `}
          >
            {source.label}
          </button>
        );
      })}
    </div>
  );
}
