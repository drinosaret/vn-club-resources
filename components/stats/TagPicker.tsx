'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Tag as TagIcon, X } from 'lucide-react';

import { vndbStatsApi } from '@/lib/vndb-stats-api';

/**
 * Picks one tag, for a surface that ranks by a single tag at a time.
 *
 * Browse has a filter that selects many tags with include and exclude modes, which is the
 * right shape there and the wrong one here: a ranking is over one tag, and offering a second
 * would imply a combination the ranking does not compute. The search endpoint is shared with
 * that filter so both return the same tags in the same order.
 *
 * Results are narrowed to tags. The endpoint also answers with traits, staff and producers,
 * none of which the ranking behind this can be asked for.
 */

export interface PickedTag {
  id: number;
  name: string;
}

interface TagPickerProps {
  selected: PickedTag | null;
  onSelect: (tag: PickedTag | null) => void;
  /** Rendered when nothing is picked yet. */
  placeholder?: string;
  /** VNDB tag categories to leave out of the results. */
  excludeCategories?: readonly string[];
}

interface TagResult {
  id: number;
  name: string;
  category: string | null;
  count: number;
}

/** Long enough that a single keystroke does not fire a request, short enough to feel direct. */
const DEBOUNCE_MS = 200;

export function TagPicker({
  selected,
  onSelect,
  placeholder,
  excludeCategories = [],
}: TagPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TagResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    // Each keystroke supersedes the one before it. Without aborting, a slow early response
    // can arrive after a later one and replace the results for what is now a stale query.
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      vndbStatsApi
        .searchFilters(trimmed, 30, controller.signal)
        .then((data) => {
          const tags = data.results
            .filter((entry) => entry.type === 'tag')
            .map((entry) => ({
              id: Number(entry.id),
              name: entry.name,
              category: entry.category,
              count: entry.count,
            }))
            .filter((entry) => Number.isFinite(entry.id))
            .filter(
              (entry) => !entry.category || !excludeCategories.includes(entry.category),
            );
          setResults(tags);
          setHighlighted(0);
          setSearching(false);
        })
        .catch(() => {
          // An aborted request is the normal case here, not a failure worth reporting.
          if (!controller.signal.aborted) {
            setResults([]);
            setSearching(false);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, excludeCategories]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const choose = useCallback(
    (tag: TagResult) => {
      onSelect({ id: tag.id, name: tag.name });
      setQuery('');
      setResults([]);
      setOpen(false);
    },
    [onSelect],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((current) => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const tag = results[highlighted];
      if (tag) choose(tag);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {selected ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1.5 text-sm font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            <TagIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{selected.name}</span>
          </span>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="inline-flex min-h-9 items-center gap-1 rounded px-2 text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
            Change tag
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder={placeholder ?? 'Search for a tag'}
              aria-label="Search for a tag"
              role="combobox"
              aria-expanded={open && results.length > 0}
              aria-controls="tag-picker-results"
              aria-autocomplete="list"
              aria-activedescendant={
                open && results[highlighted] ? `tag-option-${results[highlighted].id}` : undefined
              }
              className="w-full min-h-11 rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:min-h-0 sm:text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </div>

          {open && (query.trim().length >= 2 || results.length > 0) ? (
            <ul
              id="tag-picker-results"
              role="listbox"
              className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
            >
              {searching && !results.length ? (
                <li className="px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                  Searching
                </li>
              ) : null}
              {!searching && !results.length ? (
                <li className="px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                  No tags match that.
                </li>
              ) : null}
              {results.map((tag, index) => (
                <li
                  key={tag.id}
                  id={`tag-option-${tag.id}`}
                  role="option"
                  aria-selected={index === highlighted}
                >
                  <button
                    type="button"
                    onClick={() => choose(tag)}
                    onMouseEnter={() => setHighlighted(index)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      index === highlighted
                        ? 'bg-gray-100 dark:bg-gray-700/60'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                    }`}
                  >
                    <TagIcon className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                    <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-white">
                      {tag.name}
                    </span>
                    {tag.category ? (
                      <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
                        {tag.category}
                      </span>
                    ) : null}
                    {/* VNDB's own count for the tag, as a sense of size while choosing. The
                        ranking states its own population, which counts child tags and so
                        does not match this. */}
                    <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                      {tag.count.toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
