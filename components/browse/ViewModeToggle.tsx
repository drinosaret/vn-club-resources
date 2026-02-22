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
            ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-xs'
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
            ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-xs'
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
            ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-xs'
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
// Formula: for N cols with gap G, item_w = (100/N)% - ((N-1)*G/N)px
// Gap is gap-x-4 = 16px. Values must be exact to prevent wrapping at sidebar widths.
export const flexItemClasses: Record<GridSize, string> = {
  // small: 6 cols at xl, 5 at md, 4 at sm, 3 at base
  small: 'w-[calc(33.333%-10.667px)] sm:w-[calc(25%-12px)] md:w-[calc(20%-12.8px)] xl:w-[calc(16.667%-13.333px)]',
  // medium: 5 cols at xl, 4 at md, 3 at sm, 2 at base
  medium: 'w-[calc(50%-8px)] sm:w-[calc(33.333%-10.667px)] md:w-[calc(25%-12px)] xl:w-[calc(20%-12.8px)]',
  // large: 4 cols at xl, 3 at sm, 2 at base
  large: 'w-[calc(50%-8px)] sm:w-[calc(33.333%-10.667px)] xl:w-[calc(25%-12px)]',
};
