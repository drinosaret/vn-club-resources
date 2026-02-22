'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Tag as TagIcon, Plus, Minus, User, Pen, Mic, Building2, Newspaper } from 'lucide-react';
import { useTitlePreference, getEntityDisplayName } from '@/lib/title-preference';
import { vndbStatsApi } from '@/lib/vndb-stats-api';

export type FilterEntityType = 'tag' | 'trait' | 'staff' | 'seiyuu' | 'developer' | 'publisher';

export interface SelectedTag {
  id: string;
  name: string;
  mode: 'include' | 'exclude';
  type: FilterEntityType;
}

interface SearchResult {
  id: string;
  name: string;
  original: string | null;
  type: FilterEntityType;
  category: string | null;
  count: number;
}

interface TagFilterProps {
  selectedTags: SelectedTag[];
  onTagsChange: (tags: SelectedTag[]) => void;
  tagMode: 'and' | 'or';
  onModeChange: (mode: 'and' | 'or') => void;
}

const ENTITY_CONFIG: Record<FilterEntityType, { icon: typeof TagIcon; color: string; chipColor: string; chipIcon: typeof TagIcon }> = {
  tag: {
    icon: TagIcon,
    color: 'text-blue-500',
    chipColor: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    chipIcon: TagIcon,
  },
  trait: {
    icon: User,
    color: 'text-purple-500',
    chipColor: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
    chipIcon: User,
  },
  staff: {
    icon: Pen,
    color: 'text-green-500',
    chipColor: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
    chipIcon: Pen,
  },
  seiyuu: {
    icon: Mic,
    color: 'text-pink-500',
    chipColor: 'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300',
    chipIcon: Mic,
  },
  developer: {
    icon: Building2,
    color: 'text-orange-500',
    chipColor: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
    chipIcon: Building2,
  },
  publisher: {
    icon: Newspaper,
    color: 'text-teal-500',
    chipColor: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',
    chipIcon: Newspaper,
  },
};

export function TagFilter({ selectedTags, onTagsChange, tagMode, onModeChange }: TagFilterProps) {
  const { preference } = useTitlePreference();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search (tags, traits, staff, seiyuu, developers, publishers)
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(async () => {
      setIsLoading(true);
      try {
        const data = await vndbStatsApi.searchFilters(query, 30, abortController.signal);
        // Exclude already selected (check both id and type to avoid collisions)
        const selectedKeys = new Set(selectedTags.map((t) => `${t.type}-${t.id}`));
        const filteredResults = (data.results as SearchResult[]).filter(
          (r) => !selectedKeys.has(`${r.type}-${r.id}`)
        );
        setResults(filteredResults);
        setIsOpen(true);
        setSelectedIndex(-1);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          // Request was aborted (cleanup or timeout) — ignore silently
        } else {
          console.error('TagFilter search error:', error);
          setResults([]);
        }
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [query, selectedTags]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addTag = useCallback(
    (result: SearchResult) => {
      const newTag: SelectedTag = {
        id: result.id,
        name: getEntityDisplayName(result, preference),
        mode: 'include',
        type: result.type,
      };
      onTagsChange([...selectedTags, newTag]);
      setQuery('');
      setIsOpen(false);
      setResults([]);
      inputRef.current?.focus();
    },
    [selectedTags, onTagsChange, preference]
  );

  const removeTag = useCallback(
    (id: string, type: FilterEntityType) => {
      onTagsChange(selectedTags.filter((t) => !(t.id === id && t.type === type)));
    },
    [selectedTags, onTagsChange]
  );

  const toggleTagMode = useCallback(
    (id: string, type: FilterEntityType) => {
      onTagsChange(
        selectedTags.map((t) =>
          t.id === id && t.type === type ? { ...t, mode: t.mode === 'include' ? 'exclude' : 'include' } : t
        )
      );
    },
    [selectedTags, onTagsChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || results.length === 0) {
        if (e.key === 'Backspace' && !query && selectedTags.length > 0) {
          const last = selectedTags[selectedTags.length - 1];
          removeTag(last.id, last.type);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < results.length) {
            addTag(results[selectedIndex]);
          }
          break;
        case 'Escape':
          setIsOpen(false);
          setSelectedIndex(-1);
          break;
      }
    },
    [isOpen, results, selectedIndex, addTag, query, selectedTags, removeTag]
  );

  const includeTags = selectedTags.filter((t) => t.mode === 'include');
  const excludeTags = selectedTags.filter((t) => t.mode === 'exclude');

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div ref={containerRef} className="relative">
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => query.length >= 2 && results.length > 0 && setIsOpen(true)}
            placeholder="Search tags, traits, staff, developers..."
            className="flex-1 bg-transparent border-none outline-hidden text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
        </div>

        {/* Results dropdown */}
        {isOpen && (
          <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-72 overflow-y-auto">
            {isLoading ? (
              <div className="p-3 text-center text-sm text-gray-500">Searching...</div>
            ) : results.length === 0 ? (
              <div className="p-3 text-center text-sm text-gray-500">
                No results found for &ldquo;{query}&rdquo;
              </div>
            ) : (
              <ul className="py-1">
                {results.map((result, index) => {
                  const config = ENTITY_CONFIG[result.type];
                  const IconComponent = config.icon;
                  return (
                    <li key={`${result.type}-${result.id}`}>
                      <button
                        onClick={() => addTag(result)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={`w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 ${
                          index === selectedIndex ? 'bg-gray-100 dark:bg-gray-700' : ''
                        }`}
                      >
                        <IconComponent className={`w-4 h-4 ${config.color} shrink-0`} />
                        <span
                          className="flex-1 text-sm text-gray-900 dark:text-white truncate"
                          title={`${getEntityDisplayName(result, preference)}${result.category ? ` (${result.category})` : ''}`}
                        >
                          {getEntityDisplayName(result, preference)}
                          {result.category && (
                            <span className="text-gray-400 dark:text-gray-500 ml-1">
                              ({result.category})
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-gray-400 shrink-0">
                          {result.count.toLocaleString()}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Tag mode toggle */}
      {selectedTags.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Match:</span>
          <button
            onClick={() => onModeChange('and')}
            className={`px-2 py-1 text-xs rounded ${
              tagMode === 'and'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            ALL
          </button>
          <button
            onClick={() => onModeChange('or')}
            className={`px-2 py-1 text-xs rounded ${
              tagMode === 'or'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            ANY
          </button>
        </div>
      )}

      {/* Selected tags and traits */}
      {selectedTags.length > 0 && (
        <div className="space-y-2">
          {includeTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Include:</span>
              {includeTags.map((tag) => (
                <TagChip
                  key={`${tag.type}-${tag.id}`}
                  tag={tag}
                  onToggle={() => toggleTagMode(tag.id, tag.type)}
                  onRemove={() => removeTag(tag.id, tag.type)}
                />
              ))}
            </div>
          )}
          {excludeTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Exclude:</span>
              {excludeTags.map((tag) => (
                <TagChip
                  key={`${tag.type}-${tag.id}`}
                  tag={tag}
                  onToggle={() => toggleTagMode(tag.id, tag.type)}
                  onRemove={() => removeTag(tag.id, tag.type)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TagChip({
  tag,
  onToggle,
  onRemove,
}: {
  tag: SelectedTag;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const isExclude = tag.mode === 'exclude';
  const config = ENTITY_CONFIG[tag.type];
  const ChipIcon = config.chipIcon;

  const colorClasses = isExclude
    ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
    : config.chipColor;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colorClasses}`}
    >
      <button
        onClick={onToggle}
        className="flex items-center justify-center w-4 h-4 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
        title={isExclude ? 'Click to include' : 'Click to exclude'}
      >
        {isExclude ? <Minus className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
      </button>
      <ChipIcon className="w-3 h-3" />
      <span className={isExclude ? 'line-through' : ''}>{tag.name}</span>
      <button
        onClick={onRemove}
        className="flex items-center justify-center w-4 h-4 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
        title="Remove"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
