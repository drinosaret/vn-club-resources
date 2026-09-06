'use client';

import { useState } from 'react';
import { ChevronRight, Eye, EyeOff } from 'lucide-react';
import { BrowseFilters } from '@/lib/vndb-stats-api';
import { TagFilter, SelectedTag } from './TagFilter';

interface CollapsibleTagFilterProps {
  selectedTags: SelectedTag[];
  onTagsChange: (tags: SelectedTag[]) => void;
  filters: BrowseFilters;
  onChange: (filters: Partial<BrowseFilters>) => void;
  /** Start expanded if there are tags/traits selected */
  defaultExpanded?: boolean;
  /** Sidebar variant: no outer border, tighter padding */
  variant?: 'default' | 'sidebar';
}

const SPOILER_LEVELS = [
  { value: 0, label: 'Hide Spoilers' },
  { value: 1, label: 'Minor Spoilers' },
  { value: 2, label: 'All Spoilers' },
];

export function CollapsibleTagFilter({
  selectedTags,
  onTagsChange,
  filters,
  onChange,
  defaultExpanded,
  variant = 'default',
}: CollapsibleTagFilterProps) {
  const isSidebar = variant === 'sidebar';
  const [isExpanded, setIsExpanded] = useState(
    defaultExpanded ?? selectedTags.length > 0
  );

  // Build summary text
  const getSummaryText = () => {
    const counts: Record<string, number> = {};
    for (const t of selectedTags) {
      counts[t.type] = (counts[t.type] || 0) + 1;
    }
    const labels: [string, string][] = [
      ['tag', 'tag'], ['trait', 'trait'], ['staff', 'staff'],
      ['seiyuu', 'seiyuu'], ['developer', 'developer'], ['publisher', 'publisher'],
    ];
    const parts = labels
      .filter(([key]) => counts[key])
      .map(([key, label]) => `${counts[key]} ${label}${counts[key] > 1 ? 's' : ''}`);
    return parts.length > 0 ? `(${parts.join(', ')})` : '';
  };

  return (
    <div className={isSidebar ? '' : 'bw-panel'}>
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full flex items-center justify-between transition-colors ${
          isSidebar
            ? 'px-0 py-1.5 hover:opacity-80'
            : 'px-4 py-3 border-b border-[color:var(--rule)] hover:bg-[color:var(--surface-inset)]'
        }`}
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            className={`w-4 h-4 text-[color:var(--nezu)] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          />
          <span className="bw-label">
            {isSidebar ? 'Tags & Options' : 'Advanced Filters'}
          </span>
          {selectedTags.length > 0 && (
            <span className="text-xs text-[color:var(--ai)]">
              {getSummaryText()}
            </span>
          )}
        </div>

        {/* Quick spoiler indicator */}
        <div className="flex items-center gap-2 text-xs text-[color:var(--nezu)]">
          {(filters.spoiler_level ?? 0) === 0 ? (
            <EyeOff className="w-4 h-4" />
          ) : (
            <Eye className="w-4 h-4 text-[color:var(--kohaku)]" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className={`space-y-4 ${isSidebar ? 'pt-2' : 'p-4'}`}>
          {/* Tag Search */}
          <TagFilter
            selectedTags={selectedTags}
            onTagsChange={onTagsChange}
            tagMode={(filters.tag_mode as 'and' | 'or') || 'and'}
            onModeChange={(mode) => onChange({ tag_mode: mode })}
          />

          {/* Options Row */}
          <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-[color:var(--rule)]">
            {/* Include Child Tags Toggle */}
            <label className="flex items-center gap-2 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.include_children ?? true}
                onChange={(e) => onChange({ include_children: e.target.checked })}
                className="bw-check"
              />
              <span className="text-xs text-[color:var(--nezu)]">
                Include child tags
              </span>
            </label>

            {/* Spoiler Level Selector */}
            <div className="flex items-center gap-2">
              {(filters.spoiler_level ?? 0) === 0 ? (
                <EyeOff className="w-4 h-4 text-[color:var(--text-faint)]" />
              ) : (
                <Eye className="w-4 h-4 text-[color:var(--kohaku)]" />
              )}
              <select
                value={filters.spoiler_level ?? 0}
                onChange={(e) => onChange({ spoiler_level: Number(e.target.value) })}
                className="bw-field text-xs px-2 py-1"
              >
                {SPOILER_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
