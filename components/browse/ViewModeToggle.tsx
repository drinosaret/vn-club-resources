'use client';

import { Grid3x3, LayoutGrid, ListOrdered, Square } from 'lucide-react';

export type GridSize = 'small' | 'medium' | 'large';

/** How results are laid out. The ranked list is a presentation, not a fourth grid size. */
export type BrowseView = 'grid' | 'ranked';

interface ViewModeToggleProps {
  size: GridSize;
  onChange: (size: GridSize) => void;
  view?: BrowseView;
  onViewChange?: (view: BrowseView) => void;
}

const BUTTON_BASE = 'tab';
const SELECTED = 'tab--on';
const UNSELECTED = '';

export function ViewModeToggle({ size, onChange, view = 'grid', onViewChange }: ViewModeToggleProps) {
  // The grid sizes only mean anything while the grid is showing, so selecting one also
  // returns from the ranked list rather than changing a setting with no visible effect.
  const gridButton = (value: GridSize, label: string, Icon: typeof Grid3x3) => (
    <button
      onClick={() => {
        onChange(value);
        onViewChange?.('grid');
      }}
      className={`${BUTTON_BASE} ${view === 'grid' && size === value ? SELECTED : UNSELECTED}`}
      title={label}
      aria-pressed={view === 'grid' && size === value}
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  return (
    <div className="tabs">
      {gridButton('small', 'Small grid (6 per row)', Grid3x3)}
      {gridButton('medium', 'Medium grid (5 per row)', LayoutGrid)}
      {gridButton('large', 'Large grid (4 per row)', Square)}
      {onViewChange && (
        <button
          onClick={() => onViewChange('ranked')}
          className={`${BUTTON_BASE} ${view === 'ranked' ? SELECTED : UNSELECTED}`}
          title="Ranked list"
          aria-pressed={view === 'ranked'}
        >
          <ListOrdered className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

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
