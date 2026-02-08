'use client';

import { BrowseFilters } from '@/lib/vndb-stats-api';
import { RangeSlider } from './RangeSlider';

interface InlineRangeSlidersProps {
  filters: BrowseFilters;
  onChange: (filters: Partial<BrowseFilters>) => void;
  layout?: 'horizontal' | 'vertical';
  /** Compact mode: tighter gaps, passed through to RangeSlider */
  compact?: boolean;
}

const MIN_YEAR = 1990;
const MAX_YEAR = new Date().getFullYear();
const MIN_RATING = 1;
const MAX_RATING = 10;

export function InlineRangeSliders({ filters, onChange, layout = 'horizontal', compact }: InlineRangeSlidersProps) {
  return (
    <div className={layout === 'vertical'
      ? `grid grid-cols-1 ${compact ? 'gap-4' : 'gap-6'}`
      : 'grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8'
    }>
      <RangeSlider
        label="Year"
        min={MIN_YEAR}
        max={MAX_YEAR}
        step={1}
        minValue={filters.year_min}
        maxValue={filters.year_max}
        onChange={(minVal, maxVal) => onChange({ year_min: minVal, year_max: maxVal })}
        compact={compact}
      />

      <RangeSlider
        label="Rating"
        min={MIN_RATING}
        max={MAX_RATING}
        step={1}
        minValue={filters.min_rating}
        maxValue={filters.max_rating}
        onChange={(minVal, maxVal) => onChange({ min_rating: minVal, max_rating: maxVal })}
        compact={compact}
      />
    </div>
  );
}
