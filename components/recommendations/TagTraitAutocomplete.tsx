'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Tag, Heart, Plus, Minus } from 'lucide-react';

export interface SelectedItem {
  id: number;
  name: string;
  type: 'tag' | 'trait';
  mode: 'include' | 'exclude';
  category?: string;
}

interface SearchResult {
  id: number;
  name: string;
  type: 'tag' | 'trait';
  category: string | null;
  count: number;
}

interface TagTraitAutocompleteProps {
  selectedItems: SelectedItem[];
  onSelectionChange: (items: SelectedItem[]) => void;
  placeholder?: string;
  maxItems?: number;
  disabled?: boolean;
}

export default function TagTraitAutocomplete({
  selectedItems,
  onSelectionChange,
  placeholder = 'Search tags or traits...',
  maxItems = 20,
  disabled = false,
}: TagTraitAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search with timeout
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(async () => {
      setIsLoading(true);

      // Set up request timeout (10 seconds)
      const timeoutHandle = setTimeout(() => abortController.abort(), 10000);

      try {
        const apiUrl = process.env.NEXT_PUBLIC_VNDB_STATS_API;
        if (!apiUrl) {
          setResults([]);
          return;
        }
        const response = await fetch(
          `${apiUrl}/api/v1/vn/search-tags-traits?q=${encodeURIComponent(query)}&limit=20`,
          { signal: abortController.signal }
        );
        clearTimeout(timeoutHandle);

        if (response.ok) {
          const data = await response.json();
          // Validate response structure
          if (!data || !Array.isArray(data.results)) {
            console.warn('Invalid search response structure');
            setResults([]);
            return;
          }
          // Filter out results with missing required fields
          const validResults = data.results.filter(
            (item: Record<string, unknown>) => item && typeof item.id === 'number' && typeof item.name === 'string' && typeof item.type === 'string'
          );
          // Filter out already selected items
          const selectedIds = new Set(
            selectedItems.map((item) => `${item.type}-${item.id}`)
          );
          const filteredResults = validResults.filter(
            (r: SearchResult) => !selectedIds.has(`${r.type}-${r.id}`)
          );
          setResults(filteredResults);
          setIsOpen(true);
          setSelectedIndex(-1);
        }
      } catch (err) {
        clearTimeout(timeoutHandle);
        // Only log non-abort errors
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Search failed:', err);
        }
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [query, selectedItems]);

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

  const addItem = useCallback(
    (result: SearchResult) => {
      if (selectedItems.length >= maxItems) return;

      const newItem: SelectedItem = {
        id: result.id,
        name: result.name,
        type: result.type,
        mode: 'include', // Default to include
        category: result.category || undefined,
      };

      onSelectionChange([...selectedItems, newItem]);
      setQuery('');
      setIsOpen(false);
      setResults([]);
      inputRef.current?.focus();
    },
    [selectedItems, maxItems, onSelectionChange]
  );

  const removeItem = useCallback(
    (index: number) => {
      const newItems = [...selectedItems];
      newItems.splice(index, 1);
      onSelectionChange(newItems);
    },
    [selectedItems, onSelectionChange]
  );

  const toggleItemMode = useCallback(
    (index: number) => {
      const newItems = [...selectedItems];
      newItems[index] = {
        ...newItems[index],
        mode: newItems[index].mode === 'include' ? 'exclude' : 'include',
      };
      onSelectionChange(newItems);
    },
    [selectedItems, onSelectionChange]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || results.length === 0) {
        if (e.key === 'Backspace' && !query && selectedItems.length > 0) {
          // Remove last item on backspace when input is empty
          removeItem(selectedItems.length - 1);
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
            addItem(results[selectedIndex]);
          }
          break;
        case 'Escape':
          setIsOpen(false);
          setSelectedIndex(-1);
          break;
      }
    },
    [isOpen, results, selectedIndex, addItem, query, selectedItems, removeItem]
  );

  const clearAll = () => {
    onSelectionChange([]);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Input with chips */}
      <div
        className={`
          flex flex-wrap items-center gap-1.5 px-3 py-2 min-h-[42px]
          bg-white dark:bg-gray-700
          border border-gray-300 dark:border-gray-600
          rounded-lg
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          focus-within:ring-2 focus-within:ring-violet-500 focus-within:border-transparent
        `}
      >
        {/* Selected chips */}
        {selectedItems.map((item, index) => (
          <FilterChip
            key={`${item.type}-${item.id}`}
            item={item}
            onRemove={() => removeItem(index)}
            onToggleMode={() => toggleItemMode(index)}
          />
        ))}

        {/* Search input */}
        <div className="flex-1 min-w-[120px] flex items-center">
          <Search className="w-4 h-4 text-gray-400 mr-2 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => query.length >= 2 && results.length > 0 && setIsOpen(true)}
            placeholder={selectedItems.length === 0 ? placeholder : 'Add more...'}
            disabled={disabled || selectedItems.length >= maxItems}
            className={`
              flex-1 bg-transparent border-none outline-hidden
              text-sm text-gray-900 dark:text-gray-100
              placeholder-gray-400 dark:placeholder-gray-500
            `}
            aria-label="Search tags and traits"
            aria-expanded={isOpen}
            aria-controls="tag-trait-results"
            role="combobox"
            aria-autocomplete="list"
          />
          {selectedItems.length > 0 && (
            <button
              onClick={clearAll}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Clear all filters"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Results dropdown */}
      {isOpen && (
        <div
          id="tag-trait-results"
          role="listbox"
          className="
            absolute z-50 mt-1 w-full
            bg-white dark:bg-gray-900
            border border-gray-200 dark:border-gray-700
            rounded-lg shadow-lg
            max-h-64 overflow-y-auto
          "
        >
          {isLoading ? (
            <div className="p-3 text-center text-gray-500 dark:text-gray-400">
              <div className="inline-block w-4 h-4 border-2 border-gray-300 border-t-violet-500 rounded-full animate-spin mr-2" />
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="p-3 text-center text-gray-500 dark:text-gray-400">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <ul className="py-1">
              {results.map((result, index) => (
                <li key={`${result.type}-${result.id}`}>
                  <button
                    onClick={() => addItem(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    role="option"
                    aria-selected={index === selectedIndex}
                    className={`
                      w-full px-3 py-2 text-left flex items-center gap-2
                      hover:bg-gray-100 dark:hover:bg-gray-800
                      ${index === selectedIndex ? 'bg-gray-100 dark:bg-gray-800' : ''}
                    `}
                  >
                    {/* Type indicator */}
                    <span
                      className={`
                        flex items-center justify-center w-6 h-6 rounded
                        ${
                          result.type === 'tag'
                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                            : 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400'
                        }
                      `}
                    >
                      {result.type === 'tag' ? (
                        <Tag className="w-3.5 h-3.5" />
                      ) : (
                        <Heart className="w-3.5 h-3.5" />
                      )}
                    </span>

                    {/* Name and category */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                        {result.name}
                      </div>
                      {result.category && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {result.category}
                        </div>
                      )}
                    </div>

                    {/* Count */}
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {result.count.toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Helper text */}
      {selectedItems.length > 0 && (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Click chip icon to toggle include/exclude. {selectedItems.length}/{maxItems} selected.
        </div>
      )}
    </div>
  );
}

function FilterChip({
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
        inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
        ${
          isExclude
            ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700'
            : isTag
            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
            : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
        }
      `}
    >
      {/* Toggle mode button */}
      <button
        onClick={onToggleMode}
        className={`
          flex items-center justify-center w-4 h-4 rounded-full
          hover:bg-black/10 dark:hover:bg-white/10
          ${isExclude ? 'text-red-600 dark:text-red-400' : ''}
        `}
        title={isExclude ? 'Click to include' : 'Click to exclude'}
      >
        {isExclude ? (
          <Minus className="w-3 h-3" />
        ) : (
          <Plus className="w-3 h-3" />
        )}
      </button>

      {/* Type icon */}
      {isTag ? (
        <Tag className="w-3 h-3" />
      ) : (
        <Heart className="w-3 h-3" />
      )}

      {/* Name */}
      <span className={isExclude ? 'line-through' : ''}>{item.name}</span>

      {/* Remove button */}
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
