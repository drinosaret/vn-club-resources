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

const ENTITY_CONFIG: Record<FilterEntityType, { icon: typeof TagIcon; chipIcon: typeof TagIcon }> = {
  tag: { icon: TagIcon, chipIcon: TagIcon },
  trait: { icon: User, chipIcon: User },
  staff: { icon: Pen, chipIcon: Pen },
  seiyuu: { icon: Mic, chipIcon: Mic },
  developer: { icon: Building2, chipIcon: Building2 },
  publisher: { icon: Newspaper, chipIcon: Newspaper },
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
          // Request was aborted (cleanup or timeout); ignore silently
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
        <div className="bw-field flex items-center gap-2 px-3">
          <Search className="w-4 h-4 text-[color:var(--text-faint)] shrink-0" />
          <input
            ref={inputRef}
            type="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => query.length >= 2 && results.length > 0 && setIsOpen(true)}
            aria-label="Search tags, traits, staff and developers"
            placeholder="Search tags, traits, staff, developers..."
            className="flex-1 py-2 bg-transparent border-none outline-hidden text-sm text-[color:var(--ink)] placeholder:text-[color:var(--text-faint)]"
          />
        </div>

        {/* Results dropdown */}
        {isOpen && (
          <div className="bw-menu absolute z-50 mt-1 w-full max-h-72 overflow-y-auto">
            {isLoading ? (
              <div className="p-3 text-center text-sm text-[color:var(--nezu)]">Searching...</div>
            ) : results.length === 0 ? (
              <div className="p-3 text-center text-sm text-[color:var(--nezu)]">
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
                        className={`bw-opt w-full px-3 py-2 text-left flex items-center gap-2 ${
                          index === selectedIndex ? 'bw-opt--focus' : ''
                        }`}
                      >
                        <IconComponent className="w-4 h-4 shrink-0" />
                        <span
                          className="flex-1 text-sm truncate"
                          title={`${getEntityDisplayName(result, preference)}${result.category ? ` (${result.category})` : ''}`}
                        >
                          {getEntityDisplayName(result, preference)}
                          {result.category && (
                            <span className="text-[color:var(--text-faint)] ml-1">
                              ({result.category})
                            </span>
                          )}
                        </span>
                        <span className="bw-num text-xs text-[color:var(--text-faint)] shrink-0">
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
          <span className="bw-label">Match:</span>
          <button
            onClick={() => onModeChange('and')}
            className={`tab${tagMode === 'and' ? ' tab--on' : ''}`}
          >
            ALL
          </button>
          <button
            onClick={() => onModeChange('or')}
            className={`tab${tagMode === 'or' ? ' tab--on' : ''}`}
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
              <span className="bw-label mr-1">Include:</span>
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
              <span className="bw-label mr-1">Exclude:</span>
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

  return (
    <span className={`bw-chip ${isExclude ? 'bw-chip--off' : 'bw-chip--on'}`}>
      <button
        onClick={onToggle}
        className="bw-chip-btn w-4 h-4 hit-24"
        title={isExclude ? 'Click to include' : 'Click to exclude'}
      >
        {isExclude ? <Minus className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
      </button>
      <ChipIcon className="w-3 h-3" />
      <span className={isExclude ? 'line-through' : ''}>{tag.name}</span>
      <button
        onClick={onRemove}
        className="bw-chip-btn w-4 h-4 hit-24"
        title="Remove"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
