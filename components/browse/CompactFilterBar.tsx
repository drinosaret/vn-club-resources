'use client';

import { BrowseFilters } from '@/lib/vndb-stats-api';
import { DropdownSelect, SelectedValue } from './DropdownSelect';
import { LANGUAGES, PLATFORMS, LENGTHS, AGE_RATINGS, DEV_STATUS } from './filter-constants';

interface CompactFilterBarProps {
  filters: BrowseFilters;
  onChange: (filters: Partial<BrowseFilters>) => void;
  layout?: 'horizontal' | 'vertical';
  /** Compact mode: tighter gaps, passed through to DropdownSelect */
  compact?: boolean;
}

/**
 * Parse comma-separated include/exclude strings into SelectedValue array
 */
function parseSelected(includeStr: string | undefined, excludeStr: string | undefined): SelectedValue[] {
  const result: SelectedValue[] = [];

  if (includeStr) {
    includeStr.split(',').forEach(v => {
      const trimmed = v.trim();
      if (trimmed) result.push({ value: trimmed, mode: 'include' });
    });
  }

  if (excludeStr) {
    excludeStr.split(',').forEach(v => {
      const trimmed = v.trim();
      if (trimmed) result.push({ value: trimmed, mode: 'exclude' });
    });
  }

  return result;
}

/**
 * Convert SelectedValue array back to include/exclude strings
 */
function toFilterStrings(selected: SelectedValue[]): { include: string | undefined; exclude: string | undefined } {
  const includes = selected.filter(s => s.mode === 'include').map(s => s.value);
  const excludes = selected.filter(s => s.mode === 'exclude').map(s => s.value);

  return {
    include: includes.length > 0 ? includes.join(',') : undefined,
    exclude: excludes.length > 0 ? excludes.join(',') : undefined,
  };
}

export function CompactFilterBar({ filters, onChange, layout = 'horizontal', compact }: CompactFilterBarProps) {
  // Language
  const handleLanguageChange = (selected: SelectedValue[]) => {
    const { include, exclude } = toFilterStrings(selected);
    onChange({
      olang: include,
      exclude_olang: exclude,
    });
  };

  // Platform
  const handlePlatformChange = (selected: SelectedValue[]) => {
    const { include, exclude } = toFilterStrings(selected);
    onChange({
      platform: include,
      exclude_platform: exclude,
    });
  };

  // Length
  const handleLengthChange = (selected: SelectedValue[]) => {
    const { include, exclude } = toFilterStrings(selected);
    onChange({
      length: include,
      exclude_length: exclude,
    });
  };

  // Age Rating
  const handleAgeChange = (selected: SelectedValue[]) => {
    const { include, exclude } = toFilterStrings(selected);
    onChange({
      minage: include,
      exclude_minage: exclude,
    });
  };

  // Dev Status (special handling: -1 means all)
  const handleStatusChange = (selected: SelectedValue[]) => {
    const { include, exclude } = toFilterStrings(selected);
    onChange({
      devstatus: include || '-1', // Default to -1 (all) when nothing selected
      exclude_devstatus: exclude,
    });
  };

  return (
    <div className={layout === 'vertical'
      ? `grid grid-cols-1 ${compact ? 'gap-1.5' : 'gap-3'}`
      : 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3'
    }>
      <DropdownSelect
        label="Original Language"
        options={LANGUAGES}
        selected={parseSelected(filters.olang, filters.exclude_olang)}
        onChange={handleLanguageChange}
        compact={compact}
      />

      <DropdownSelect
        label="Platform"
        options={PLATFORMS}
        selected={parseSelected(filters.platform, filters.exclude_platform)}
        onChange={handlePlatformChange}
        compact={compact}
      />

      <DropdownSelect
        label="Length"
        options={LENGTHS}
        selected={parseSelected(filters.length, filters.exclude_length)}
        onChange={handleLengthChange}
        compact={compact}
      />

      <DropdownSelect
        label="Age Rating"
        options={AGE_RATINGS}
        selected={parseSelected(filters.minage, filters.exclude_minage)}
        onChange={handleAgeChange}
        compact={compact}
      />

      <DropdownSelect
        label="Status"
        options={DEV_STATUS}
        selected={parseSelected(
          filters.devstatus && filters.devstatus !== '-1' ? filters.devstatus : undefined,
          filters.exclude_devstatus
        )}
        onChange={handleStatusChange}
        compact={compact}
      />
    </div>
  );
}
