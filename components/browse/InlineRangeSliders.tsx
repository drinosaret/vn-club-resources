'use client';

import { BrowseFilters } from '@/lib/vndb-stats-api';
import { RangeSlider } from './RangeSlider';
import { DIFFICULTY_BANDS } from '@/lib/difficulty';
import { YEAR_RANGE, RATING_RANGE, VOTES_RANGE, DIFFICULTY_RANGE } from './filter-constants';

interface InlineRangeSlidersProps {
  filters: BrowseFilters;
  onChange: (filters: Partial<BrowseFilters>) => void;
  layout?: 'horizontal' | 'vertical';
  /** Compact mode: tighter gaps, passed through to RangeSlider */
  compact?: boolean;
}

const { min: MIN_YEAR, max: MAX_YEAR } = YEAR_RANGE;
const { min: MIN_RATING, max: MAX_RATING } = RATING_RANGE;
const { min: MIN_VOTES, max: MAX_VOTES } = VOTES_RANGE;
const { min: MIN_DIFFICULTY, max: MAX_DIFFICULTY } = DIFFICULTY_RANGE;

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

      <RangeSlider
        label="Votes"
        min={MIN_VOTES}
        max={MAX_VOTES}
        step={10}
        minValue={filters.min_votecount}
        maxValue={filters.max_votecount}
        onChange={(minVal, maxVal) => onChange({ min_votecount: minVal, max_votecount: maxVal })}
        formatValue={(v) => v >= MAX_VOTES ? `${MAX_VOTES.toLocaleString()}+` : v.toLocaleString()}
        compact={compact}
      />

      <RangeSlider
        label="Japanese difficulty"
        hint="Only titles whose script has been analysed"
        min={MIN_DIFFICULTY}
        max={MAX_DIFFICULTY}
        step={1}
        minValue={filters.min_difficulty}
        maxValue={filters.max_difficulty}
        onChange={(minVal, maxVal) => onChange({ min_difficulty: minVal, max_difficulty: maxVal })}
        formatValue={(v) => DIFFICULTY_BANDS[v]?.label ?? String(v)}
        compact={compact}
      />
    </div>
  );
}
