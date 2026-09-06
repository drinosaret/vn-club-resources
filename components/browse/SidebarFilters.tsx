'use client';

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
  hideAlphabet?: boolean;
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
  hideAlphabet,
}: SidebarFiltersProps) {
  return (
    <aside className="hidden lg:block w-[280px] shrink-0">
      <div className="bw-panel sticky top-20 max-h-[calc(100vh-5rem)] overflow-y-auto scrollbar-thin p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="bw-label">Filters</h2>
          {hasActiveFilters && (
            <button
              onClick={onClearFilters}
              className="sec-more"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Dropdowns: Language, Platform, Length, Age Rating, Status */}
        <CompactFilterBar filters={filters} onChange={onChange} layout="vertical" compact />

        {/* Tags, Traits & Options (collapsible) */}
        <div className="border-t border-[color:var(--rule)] mt-3 pt-3">
          <CollapsibleTagFilter
            selectedTags={selectedTags}
            onTagsChange={onTagsChange}
            filters={filters}
            onChange={onChange}
            variant="sidebar"
          />
        </div>

        {/* Range Sliders: Year, Rating */}
        <div className="border-t border-[color:var(--rule)] mt-3 pt-3">
          <InlineRangeSliders filters={filters} onChange={onChange} layout="vertical" compact />
        </div>

        {/* Alphabet Filter */}
        {!hideAlphabet && (
          <div className="border-t border-[color:var(--rule)] mt-3 pt-3">
            <AlphabetFilter
              activeChar={activeChar}
              onSelect={onAlphabetClick}
              compact
            />
          </div>
        )}
      </div>
    </aside>
  );
}
