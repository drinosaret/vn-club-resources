'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Tag, Heart, Minus } from 'lucide-react';
import { DropdownSelect, SelectedValue } from '../browse/DropdownSelect';
import { SelectedItem } from './TagTraitAutocomplete';

interface RecommendationFilters {
  minRating: string;
  length: string[];  // Now an array for multi-select
  japaneseOnly: boolean;
  spoilerLevel: number;  // 0=none, 1=minor, 2=major
}

interface CompactRecommendationFiltersProps {
  filters: RecommendationFilters;
  onFilterChange: (filters: Partial<RecommendationFilters>) => void;
  tagTraitFilters: SelectedItem[];
  onRemoveTagTrait: (index: number) => void;
  onToggleTagTraitMode: (index: number) => void;
  onClearAll: () => void;
}

const LENGTH_OPTIONS = [
  { value: '1', label: 'Very Short (<2h)' },
  { value: '2', label: 'Short (2-10h)' },
  { value: '3', label: 'Medium (10-30h)' },
  { value: '4', label: 'Long (30-50h)' },
  { value: '5', label: 'Very Long (50h+)' },
];

const LENGTH_LABELS: Record<string, string> = {
  '1': 'Very Short',
  '2': 'Short',
  '3': 'Medium',
  '4': 'Long',
  '5': 'Very Long',
};

export function CompactRecommendationFilters({
  filters,
  onFilterChange,
  tagTraitFilters,
  onRemoveTagTrait,
  onToggleTagTraitMode,
  onClearAll,
}: CompactRecommendationFiltersProps) {
  // Convert length array to SelectedValue format (include mode only for recommendations)
  const lengthSelected: SelectedValue[] = filters.length.map((v) => ({
    value: v,
    mode: 'include',
  }));

  const handleLengthChange = (selected: SelectedValue[]) => {
    const values = selected.filter((s) => s.mode === 'include').map((s) => s.value);
    onFilterChange({ length: values });
  };

  // Check if any filters are active (non-default)
  const hasActiveFilters =
    filters.minRating !== '' ||
    filters.length.length > 0 ||
    !filters.japaneseOnly ||
    filters.spoilerLevel > 0 ||
    tagTraitFilters.length > 0;

  return (
    <div className="space-y-4">
      {/* Compact Filter Row: Dropdowns + Rating Slider */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
        <DropdownSelect
          label="Length"
          options={LENGTH_OPTIONS}
          selected={lengthSelected}
          onChange={handleLengthChange}
          placeholder="Any"
          allowExclude={false}
        />

        {/* Original Language Toggle */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Original Language
          </label>
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden h-[38px]">
            <button
              type="button"
              onClick={() => onFilterChange({ japaneseOnly: true })}
              className={`flex-1 px-3 text-sm font-medium transition-colors ${
                filters.japaneseOnly
                  ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              Japanese
            </button>
            <button
              type="button"
              onClick={() => onFilterChange({ japaneseOnly: false })}
              className={`flex-1 px-3 text-sm font-medium transition-colors border-l border-gray-200 dark:border-gray-700 ${
                !filters.japaneseOnly
                  ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              Any
            </button>
          </div>
        </div>

        {/* Spoiler Level Toggle */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Spoiler Level
          </label>
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden h-[38px]">
            {([0, 1, 2] as const).map((level) => {
              const labels = ['None', 'Minor', 'Major'];
              const isActive = filters.spoilerLevel === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => onFilterChange({ spoilerLevel: level })}
                  className={`flex-1 px-2 text-sm font-medium transition-colors ${
                    level > 0 ? 'border-l border-gray-200 dark:border-gray-700' : ''
                  } ${
                    isActive
                      ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                      : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {labels[level]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Min Rating Slider */}
        <MinRatingSlider
          value={filters.minRating ? parseFloat(filters.minRating) : undefined}
          onChange={(value) => onFilterChange({ minRating: value ? String(value) : '' })}
        />
      </div>

      {/* Active Filter Chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Tag/Trait chips */}
          {tagTraitFilters.map((item, index) => (
            <TagTraitChip
              key={`${item.type}-${item.id}`}
              item={item}
              onRemove={() => onRemoveTagTrait(index)}
              onToggleMode={() => onToggleTagTraitMode(index)}
            />
          ))}

          {/* Min Rating chip */}
          {filters.minRating && (
            <FilterChip
              label={`Rating ≥${filters.minRating}`}
              onRemove={() => onFilterChange({ minRating: '' })}
            />
          )}

          {/* Length chips */}
          {filters.length.map((len) => (
            <FilterChip
              key={`length-${len}`}
              label={LENGTH_LABELS[len] || len}
              onRemove={() =>
                onFilterChange({ length: filters.length.filter((l) => l !== len) })
              }
            />
          ))}

          {/* Non-Japanese chip (shows when "Any Language" is selected) */}
          {!filters.japaneseOnly && (
            <FilterChip
              label="Any Language"
              onRemove={() => onFilterChange({ japaneseOnly: true })}
            />
          )}

          {/* Spoiler level chip (shows when not default) */}
          {filters.spoilerLevel > 0 && (
            <FilterChip
              label={filters.spoilerLevel === 1 ? 'Minor Spoilers' : 'Major Spoilers'}
              onRemove={() => onFilterChange({ spoilerLevel: 0 })}
            />
          )}

          {/* Clear all link */}
          {(tagTraitFilters.length > 0 ||
            filters.minRating ||
            filters.length.length > 0 ||
            !filters.japaneseOnly ||
            filters.spoilerLevel > 0) && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Simple min-only rating slider
function MinRatingSlider({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const min = 1;
  const max = 10;
  const step = 0.5;
  const [localValue, setLocalValue] = useState(value ?? min);
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  // Sync with external value
  useEffect(() => {
    setLocalValue(value ?? min);
  }, [value]);

  const getPercentage = (val: number) => ((val - min) / (max - min)) * 100;

  const getValueFromPosition = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return min;
      const rect = trackRef.current.getBoundingClientRect();
      const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const rawValue = min + percentage * (max - min);
      return Math.round(rawValue / step) * step;
    },
    [min, max, step]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const val = getValueFromPosition(e.clientX);
    setLocalValue(val);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const val = getValueFromPosition(e.clientX);
      setLocalValue(Math.max(min, Math.min(max, val)));
    },
    [isDragging, getValueFromPosition, min, max]
  );

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      const newValue = localValue === min ? undefined : localValue;
      onChange(newValue);
    }
    setIsDragging(false);
  }, [isDragging, localValue, min, onChange]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Touch support
  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    if (e.touches[0]) {
      const val = getValueFromPosition(e.touches[0].clientX);
      setLocalValue(val);
    }
  };

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isDragging || !e.touches[0]) return;
      const val = getValueFromPosition(e.touches[0].clientX);
      setLocalValue(Math.max(min, Math.min(max, val)));
    },
    [isDragging, getValueFromPosition, min, max]
  );

  const handleTouchEnd = useCallback(() => {
    if (isDragging) {
      const newValue = localValue === min ? undefined : localValue;
      onChange(newValue);
    }
    setIsDragging(false);
  }, [isDragging, localValue, min, onChange]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleTouchEnd);
      return () => {
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [isDragging, handleTouchMove, handleTouchEnd]);

  const handleReset = () => {
    setLocalValue(min);
    onChange(undefined);
  };

  const percent = getPercentage(localValue);
  const isFiltered = localValue !== min;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
          Min Rating
        </label>
        {isFiltered && (
          <button
            onClick={handleReset}
            className="text-xs text-violet-600 dark:text-violet-400 hover:underline"
          >
            Reset
          </button>
        )}
      </div>

      {/* Value display */}
      <div className="text-sm font-medium text-center">
        <span className={isFiltered ? 'text-violet-600 dark:text-violet-400' : 'text-gray-500 dark:text-gray-400'}>
          {localValue === min ? 'Any' : `≥${localValue.toFixed(1)}`}
        </span>
      </div>

      {/* Slider track */}
      <div
        ref={trackRef}
        className="relative h-2 bg-gray-200 dark:bg-gray-600 rounded-full cursor-pointer"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {/* Filled portion */}
        <div
          className="absolute h-full bg-violet-500 rounded-full"
          style={{ width: `${percent}%` }}
        />

        {/* Thumb */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white dark:bg-gray-200 border-2 border-violet-500 rounded-full cursor-grab shadow-md transition-transform hover:scale-110 ${
            isDragging ? 'scale-125 cursor-grabbing' : ''
          }`}
          style={{ left: `${percent}%`, marginLeft: '-8px' }}
        />
      </div>

      {/* Scale markers */}
      <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 px-1">
        <span>1</span>
        <span>5</span>
        <span>10</span>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700">
      <span>{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="hover:bg-black/10 dark:hover:bg-white/10 rounded-full p-0.5 transition-colors"
        aria-label={`Remove ${label} filter`}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

function TagTraitChip({
  item,
  onRemove,
  onToggleMode,
}: {
  item: SelectedItem;
  onRemove: () => void;
  onToggleMode: () => void;
}) {
  const isExclude = item.mode === 'exclude';
  const isTag = item.type === 'tag';

  return (
    <span
      className={`
        inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium
        ${
          isExclude
            ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700'
            : isTag
            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
            : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700'
        }
      `}
    >
      {/* Toggle mode button */}
      <button
        onClick={onToggleMode}
        className="hover:bg-black/10 dark:hover:bg-white/10 rounded-full p-0.5 transition-colors"
        title={isExclude ? 'Click to include' : 'Click to exclude'}
      >
        {isExclude ? <Minus className="w-3 h-3" /> : null}
        {isTag ? <Tag className="w-3 h-3" /> : <Heart className="w-3 h-3" />}
      </button>

      <span className={isExclude ? 'line-through' : ''}>{item.name}</span>

      <button
        onClick={onRemove}
        className="hover:bg-black/10 dark:hover:bg-white/10 rounded-full p-0.5 transition-colors"
        title="Remove"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
