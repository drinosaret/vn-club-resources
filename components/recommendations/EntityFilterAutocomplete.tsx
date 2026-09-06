'use client';

import { useState, useEffect, useId, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import { useTitlePreference, getEntityDisplayName } from '@/lib/title-preference';
import {
  EntityFilterType,
  RecommendationEntity,
  MAX_ENTITY_FILTERS,
} from '@/lib/recommendation-filters';

interface SearchResult {
  id: string;
  name: string;
  original: string | null;
  type: string;
  category: string | null;
  count: number;
}

interface EntityFilterAutocompleteProps {
  selected: RecommendationEntity[];
  onChange: (entities: RecommendationEntity[]) => void;
  maxItems?: number;
}

/**
 * What each kind of entity is called. Five kinds separated by five hues would be five more
 * colours than the page can carry, and the kind is short enough to say outright.
 */
const ENTITY_LABELS: Record<EntityFilterType, string> = {
  staff: 'Staff',
  seiyuu: 'Seiyuu',
  developer: 'Developer',
  publisher: 'Publisher',
  producer: 'Producer',
};

function isOfferedType(value: string): value is EntityFilterType {
  return value === 'staff' || value === 'seiyuu' || value === 'developer' || value === 'publisher';
}

/**
 * Picker for the people and studios behind a title. It shares the catalogue-wide filter
 * search with browse, keeping only the entity types: tags and traits have their own control
 * on this page, with their own include and exclude modes.
 */
export function EntityFilterAutocomplete({
  selected,
  onChange,
  maxItems = MAX_ENTITY_FILTERS,
}: EntityFilterAutocompleteProps) {
  const { preference } = useTitlePreference();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const isFull = selected.length >= maxItems;

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(async () => {
      setIsLoading(true);
      try {
        const data = await vndbStatsApi.searchFilters(query, 30, abortController.signal);
        const selectedKeys = new Set(selected.map((entity) => `${entity.type}-${entity.id}`));
        const offered = data.results.filter(
          (result) => isOfferedType(result.type) && !selectedKeys.has(`${result.type}-${result.id}`),
        );
        setResults(offered);
        setIsOpen(true);
        setFocusedIndex(-1);
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'AbortError') {
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
  }, [query, selected]);

  // The highlight is moved without moving focus, so the row it lands on has to be brought
  // into view by hand once the list is longer than the popup.
  useEffect(() => {
    if (focusedIndex < 0) return;
    document.getElementById(`${listboxId}-opt-${focusedIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex, listboxId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addEntity = useCallback(
    (result: SearchResult) => {
      if (!isOfferedType(result.type) || selected.length >= maxItems) return;
      onChange([
        ...selected,
        // Both names are kept rather than the one shown now, so the chip can follow the
        // switch if the reader changes it later.
        { id: result.id, name: result.name, original: result.original, type: result.type },
      ]);
      setQuery('');
      setResults([]);
      setIsOpen(false);
      inputRef.current?.focus();
    },
    [selected, maxItems, onChange, preference],
  );

  const removeEntity = useCallback(
    (entity: RecommendationEntity) => {
      onChange(selected.filter((item) => !(item.id === entity.id && item.type === entity.type)));
    },
    [selected, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || results.length === 0) {
        if (e.key === 'Backspace' && !query && selected.length > 0) {
          removeEntity(selected[selected.length - 1]);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < results.length) addEntity(results[focusedIndex]);
          break;
        case 'Escape':
          // Marked handled so a surrounding disclosure listening for Escape does not also
          // close on the press that only dismissed this list.
          e.preventDefault();
          setIsOpen(false);
          setFocusedIndex(-1);
          break;
      }
    },
    [isOpen, results, focusedIndex, addEntity, query, selected, removeEntity],
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="rc-field flex items-center gap-2 px-3 py-2 min-h-[38px]">
        <Search aria-hidden className="w-4 h-4 shrink-0 text-[color:var(--text-faint)]" />
        <input
          ref={inputRef}
          type="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query.trim().length >= 2 && results.length > 0 && setIsOpen(true)}
          placeholder={isFull ? 'Limit reached' : 'Search writers, artists, seiyuu, studios...'}
          disabled={isFull}
          className="flex-1 bg-transparent border-none outline-hidden text-sm text-[color:var(--ink)] placeholder:text-[color:var(--text-faint)]"
          aria-label="Search staff, seiyuu and studios"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={isOpen && focusedIndex >= 0 ? `${listboxId}-opt-${focusedIndex}` : undefined}
          role="combobox"
          aria-autocomplete="list"
        />
      </div>

      {/* The popup is hidden rather than unmounted, and the list carries the listbox role
          itself, so the references from the input resolve whether or not it is open. */}
      <div className="rc-menu absolute z-50 mt-1 w-full max-h-64 overflow-y-auto" hidden={!isOpen}>
        {isLoading && (
          <p className="rc-why flex items-center justify-center gap-2 p-3">
            <span aria-hidden className="rc-spin w-3 h-3" />
            Searching...
          </p>
        )}
        {!isLoading && results.length === 0 && (
          <p className="rc-why p-3 text-center">
            No staff or studios match &ldquo;{query}&rdquo;.
          </p>
        )}
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Staff, seiyuu and studio results"
          className="py-1"
          hidden={isLoading || results.length === 0}
        >
          {results.map((result, index) => (
            <li
              key={`${result.type}-${result.id}`}
              id={`${listboxId}-opt-${index}`}
              role="option"
              aria-selected={index === focusedIndex}
              onClick={() => addEntity(result)}
              onMouseEnter={() => setFocusedIndex(index)}
              className={`rc-opt w-full px-3 py-2 text-left flex items-center gap-2 cursor-pointer ${
                index === focusedIndex ? 'rc-opt--focus' : ''
              }`}
            >
              <span className="rc-kind w-16 shrink-0">
                {ENTITY_LABELS[result.type as EntityFilterType]}
              </span>
              <span className="flex-1 min-w-0 truncate text-sm text-[color:var(--ink)]">
                {getEntityDisplayName(result, preference)}
              </span>
              <span className="rc-num text-xs shrink-0 text-[color:var(--text-faint)]">
                {result.count.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((entity) => (
            <span key={`${entity.type}-${entity.id}`} className="rc-chip rc-chip--on">
              <span className="rc-kind">{ENTITY_LABELS[entity.type]}</span>
              <span>{getEntityDisplayName(entity, preference)}</span>
              <button
                type="button"
                onClick={() => removeEntity(entity)}
                className="rc-chip-btn"
                aria-label={`Remove ${entity.name} filter`}
              >
                <X aria-hidden className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
