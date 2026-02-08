'use client';

import { Grid3x3, LayoutGrid, Square } from 'lucide-react';

export type GridSize = 'small' | 'medium' | 'large';

interface ViewModeToggleProps {
  size: GridSize;
  onChange: (size: GridSize) => void;
}

export function ViewModeToggle({ size, onChange }: ViewModeToggleProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
      <button
        onClick={() => onChange('small')}
        className={`p-1.5 rounded transition-colors ${
          size === 'small'
            ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
        }`}
        title="Small grid (7 per row)"
      >
        <Grid3x3 className="w-4 h-4" />
      </button>
      <button
        onClick={() => onChange('medium')}
        className={`p-1.5 rounded transition-colors ${
          size === 'medium'
            ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
        }`}
        title="Medium grid (5 per row)"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
      <button
        onClick={() => onChange('large')}
        className={`p-1.5 rounded transition-colors ${
          size === 'large'
            ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
        }`}
        title="Large grid (3 per row)"
      >
        <Square className="w-4 h-4" />
      </button>
    </div>
  );
}

// Grid CSS classes for each size
// Column counts are chosen to work well with ITEMS_PER_PAGE values for complete rows
export const gridSizeClasses: Record<GridSize, string> = {
  small: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 xl:grid-cols-6',
  medium: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5',
  large: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4',
};

// Item width classes for flexbox layout (centers last row)
// Percentages calculated from column counts with gap consideration
export const flexItemClasses: Record<GridSize, string> = {
  // small: 6 cols at xl (16.66%), 5 at lg/md (20%), 4 at sm (25%), 3 at base (33.33%)
  small: 'w-[calc(33.33%-8px)] sm:w-[calc(25%-9px)] md:w-[calc(20%-9.6px)] xl:w-[calc(16.66%-10px)]',
  // medium: 5 cols at xl (20%), 4 at lg/md (25%), 3 at sm (33.33%), 2 at base (50%)
  medium: 'w-[calc(50%-6px)] sm:w-[calc(33.33%-8px)] md:w-[calc(25%-9px)] xl:w-[calc(20%-9.6px)]',
  // large: 4 cols at xl (25%), 3 at lg/md/sm (33.33%), 2 at base (50%)
  large: 'w-[calc(50%-6px)] sm:w-[calc(33.33%-8px)] xl:w-[calc(25%-9px)]',
};
