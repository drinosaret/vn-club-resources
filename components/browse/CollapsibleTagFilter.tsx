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
    <div className={isSidebar ? '' : 'border border-gray-200 dark:border-gray-700 rounded-lg'}>
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full flex items-center justify-between transition-colors ${
          isSidebar
            ? 'px-0 py-1.5 hover:opacity-80'
            : 'px-4 py-3 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          />
          <span className={`font-medium text-gray-700 dark:text-gray-300 ${isSidebar ? 'text-xs' : 'text-sm'}`}>
            {isSidebar ? 'Tags & Options' : 'Advanced Filters'}
          </span>
          {selectedTags.length > 0 && (
            <span className="text-xs text-primary-600 dark:text-primary-400">
              {getSummaryText()}
            </span>
          )}
        </div>

        {/* Quick spoiler indicator */}
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {(filters.spoiler_level ?? 0) === 0 ? (
            <EyeOff className="w-4 h-4" />
          ) : (
            <Eye className="w-4 h-4 text-amber-500" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className={`space-y-4 ${
          isSidebar
            ? 'pt-2'
            : 'p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700'
        }`}>
          {/* Tag Search */}
          <TagFilter
            selectedTags={selectedTags}
            onTagsChange={onTagsChange}
            tagMode={(filters.tag_mode as 'and' | 'or') || 'and'}
            onModeChange={(mode) => onChange({ tag_mode: mode })}
          />

          {/* Options Row */}
          <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-gray-100 dark:border-gray-700">
            {/* Include Child Tags Toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.include_children ?? true}
                onChange={(e) => onChange({ include_children: e.target.checked })}
                className="w-4 h-4 text-primary-600 bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded-sm focus:ring-primary-500"
              />
              <span className="text-xs text-gray-600 dark:text-gray-400">
                Include child tags
              </span>
            </label>

            {/* Spoiler Level Selector */}
            <div className="flex items-center gap-2">
              {(filters.spoiler_level ?? 0) === 0 ? (
                <EyeOff className="w-4 h-4 text-gray-400" />
              ) : (
                <Eye className="w-4 h-4 text-amber-500" />
              )}
              <select
                value={filters.spoiler_level ?? 0}
                onChange={(e) => onChange({ spoiler_level: Number(e.target.value) })}
                className="text-xs px-2 py-1 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-primary-500"
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
