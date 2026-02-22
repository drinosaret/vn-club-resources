'use client';

import { LayoutGrid, List } from 'lucide-react';

export type ViewMode = 'table' | 'cards';

export function EntityViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div className="flex items-center gap-0.5 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
      <button
        onClick={() => onChange('table')}
        className={`p-1.5 rounded transition-colors ${
          mode === 'table'
            ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-xs'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
        }`}
        title="Table view"
      >
        <List className="w-4 h-4" />
      </button>
      <button
        onClick={() => onChange('cards')}
        className={`p-1.5 rounded transition-colors ${
          mode === 'cards'
            ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-xs'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
        }`}
        title="Card view"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
    </div>
  );
}
