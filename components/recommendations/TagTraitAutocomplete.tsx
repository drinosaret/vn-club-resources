'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Plus, Minus } from 'lucide-react';
import { getBackendUrl } from '@/lib/config';

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
        const response = await fetch(
          `${getBackendUrl()}/api/v1/vn/search-tags-traits?q=${encodeURIComponent(query)}&limit=20`,
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
          // Marked handled so a surrounding disclosure listening for Escape does not also
          // close on the press that only dismissed this list.
          e.preventDefault();
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
        className={`rc-field flex flex-wrap items-center gap-1.5 px-3 py-2 min-h-[42px] ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
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
        <div className="flex-1 min-w-[120px] flex items-center gap-2">
          <Search aria-hidden className="w-4 h-4 shrink-0 text-[color:var(--text-faint)]" />
          <input
            ref={inputRef}
            type="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => query.length >= 2 && results.length > 0 && setIsOpen(true)}
            placeholder={selectedItems.length === 0 ? placeholder : 'Add more...'}
            disabled={disabled || selectedItems.length >= maxItems}
            className="flex-1 bg-transparent border-none outline-hidden text-sm text-[color:var(--ink)] placeholder:text-[color:var(--text-faint)]"
            aria-label="Search tags and traits"
            aria-expanded={isOpen}
            aria-controls="tag-trait-results"
            role="combobox"
            aria-autocomplete="list"
          />
          {selectedItems.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="rc-chip-btn"
              aria-label="Clear all filters"
            >
              <X aria-hidden className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Results dropdown */}
      {isOpen && (
        <div
          id="tag-trait-results"
          role="listbox"
          className="rc-menu absolute z-50 mt-1 w-full max-h-64 overflow-y-auto"
        >
          {isLoading ? (
            <p className="rc-why flex items-center justify-center gap-2 p-3">
              <span aria-hidden className="rc-spin w-3 h-3" />
              Searching...
            </p>
          ) : results.length === 0 ? (
            <p className="rc-why p-3 text-center">No results for &ldquo;{query}&rdquo;</p>
          ) : (
            <ul className="py-1">
              {results.map((result, index) => (
                <li key={`${result.type}-${result.id}`}>
                  <button
                    type="button"
                    onClick={() => addItem(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    role="option"
                    aria-selected={index === selectedIndex}
                    className={`rc-opt w-full px-3 py-2 text-left flex items-center gap-2 ${
                      index === selectedIndex ? 'rc-opt--focus' : ''
                    }`}
                  >
                    {/* Which of the two lists the row came from. A name alone does not say. */}
                    <span className="rc-kind w-9 shrink-0">{result.type}</span>

                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-sm text-[color:var(--ink)]">
                        {result.name}
                      </span>
                      {result.category && (
                        <span className="rc-why block truncate">{result.category}</span>
                      )}
                    </span>

                    <span className="rc-num text-xs text-[color:var(--text-faint)]">
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
        <p className="rc-why mt-1">
          Click chip icon to toggle include/exclude.{' '}
          <span className="rc-num">
            {selectedItems.length}/{maxItems}
          </span>{' '}
          selected.
        </p>
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

  return (
    <span className={`rc-chip ${isExclude ? 'rc-chip--off' : 'rc-chip--on'}`}>
      <button
        type="button"
        onClick={onToggleMode}
        className="rc-chip-btn"
        aria-label={isExclude ? `Include ${item.name}` : `Exclude ${item.name}`}
        title={isExclude ? 'Click to include' : 'Click to exclude'}
      >
        {isExclude ? <Minus aria-hidden className="w-3 h-3" /> : <Plus aria-hidden className="w-3 h-3" />}
      </button>

      <span className="rc-kind">{item.type}</span>
      <span className={isExclude ? 'line-through' : ''}>{item.name}</span>

      <button type="button" onClick={onRemove} className="rc-chip-btn" aria-label={`Remove ${item.name} filter`}>
        <X aria-hidden className="w-3 h-3" />
      </button>
    </span>
  );
}
