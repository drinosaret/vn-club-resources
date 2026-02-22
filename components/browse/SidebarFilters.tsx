'use client';

import { X } from 'lucide-react';
import { BrowseFilters } from '@/lib/vndb-stats-api';
import { CompactFilterBar } from './CompactFilterBar';
import { InlineRangeSliders } from './InlineRangeSliders';
import { SelectedTag } from './TagFilter';
import { CollapsibleTagFilter } from './CollapsibleTagFilter';
import { AlphabetFilter } from './AlphabetFilter';

interface SidebarFiltersProps {
  filters: BrowseFilters;
  onChange: (filters: Partial<BrowseFilters>) => void;
  selectedTags: SelectedTag[];
  onTagsChange: (tags: SelectedTag[]) => void;
  activeChar: string | null;
  onAlphabetClick: (char: string | null) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function SidebarFilters({
  filters,
  onChange,
  selectedTags,
  onTagsChange,
  activeChar,
  onAlphabetClick,
  hasActiveFilters,
  onClearFilters,
}: SidebarFiltersProps) {
  return (
    <aside className="hidden lg:block w-[280px] shrink-0">
      <div className="sticky top-20 max-h-[calc(100vh-5rem)] overflow-y-auto scrollbar-thin
                      bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Filters</h3>
          {hasActiveFilters && (
            <button
              onClick={onClearFilters}
              className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
            >
              <X className="w-3 h-3" />
              Clear all
            </button>
          )}
        </div>

        {/* Dropdowns: Language, Platform, Length, Age Rating, Status */}
        <CompactFilterBar filters={filters} onChange={onChange} layout="vertical" compact />

        {/* Tags, Traits & Options (collapsible) */}
        <div className="border-t border-gray-100 dark:border-gray-700/50 mt-3 pt-3">
          <CollapsibleTagFilter
            selectedTags={selectedTags}
            onTagsChange={onTagsChange}
            filters={filters}
            onChange={onChange}
            variant="sidebar"
          />
        </div>

        {/* Range Sliders: Year, Rating */}
        <div className="border-t border-gray-100 dark:border-gray-700/50 mt-3 pt-3">
          <InlineRangeSliders filters={filters} onChange={onChange} layout="vertical" compact />
        </div>

        {/* Alphabet Filter */}
        <div className="border-t border-gray-100 dark:border-gray-700/50 mt-3 pt-3">
          <AlphabetFilter
            activeChar={activeChar}
            onSelect={onAlphabetClick}
            compact
          />
        </div>
      </div>
    </aside>
  );
}
