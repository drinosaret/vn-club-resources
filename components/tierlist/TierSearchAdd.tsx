'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { VNSearchResult, CharacterSearchResult } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl, getTinySrc } from '@/lib/vndb-image-cache';
import { getDisplayTitle, useDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import { NSFW_THRESHOLD } from '@/lib/nsfw-reveal';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';
import type { TierVN, TierListMode } from '@/lib/tier-config';

type SearchResult = VNSearchResult | CharacterSearchResult;

function isVNResult(result: SearchResult): result is VNSearchResult {
  return 'title' in result && !('vn_name' in result);
}

interface TierSearchAddProps {
  mode: TierListMode;
  onAdd: (item: TierVN) => void;
  isItemInList: (itemId: string) => boolean;
  isAtCapacity?: boolean;
}

export function TierSearchAdd({ mode, onAdd, isItemInList, isAtCapacity }: TierSearchAddProps) {
  const displayTitle = useDisplayTitle();
  const { preference } = useTitlePreference();
  const locale = useLocale();
  const s = tierListStrings[locale];
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isError, setIsError] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (abortRef.current) abortRef.current.abort();
    if (q.length < 2) {
      setResults([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setIsError(false);

    try {
      let searchResults: SearchResult[];

      if (mode === 'characters') {
        const res = await vndbStatsApi.searchCharacters(q, 10, controller.signal);
        searchResults = res.results;
      } else {
        // If query looks like a VNDB ID (e.g. "v123" or "123"), also try direct lookup
        const idMatch = q.trim().match(/^v?(\d+)$/i);
        const [searchRes, idRes] = await Promise.all([
          vndbStatsApi.searchVNs(q, 10, controller.signal, null, true),
          idMatch ? vndbStatsApi.getVN(`v${idMatch[1]}`) : null,
        ]);
        searchResults = searchRes.results;
        // Prepend ID result if found and not already in search results
        if (idRes && !searchResults.some(r => r.id === idRes.id)) {
          searchResults = [{
            id: idRes.id,
            title: idRes.title,
            title_jp: idRes.title_jp,
            title_romaji: idRes.title_romaji,
            image_url: idRes.image_url,
            image_sexual: idRes.image_sexual,
            released: idRes.released,
            rating: idRes.rating,
          }, ...searchResults];
        }
      }

      if (!controller.signal.aborted) {
        setResults(searchResults);
        setIsOpen(searchResults.length > 0);
        setSelectedIndex(-1);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (!controller.signal.aborted) setIsError(true);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [mode]);

  const handleInputChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 350);
  }, [search]);

  const handleSelect = useCallback((result: SearchResult) => {
    if (isVNResult(result)) {
      const imageUrl = result.image_url
        ? getProxiedImageUrl(result.image_url, { width: 128, vnId: result.id })
        : null;
      onAdd({
        id: result.id,
        title: result.title,
        titleJp: result.title_jp,
        titleRomaji: result.title_romaji,
        imageUrl,
        imageSexual: result.image_sexual ?? null,
      });
    } else {
      // Character result
      const imageUrl = result.image_url
        ? getProxiedImageUrl(result.image_url, { width: 128, vnId: result.id })
        : null;
      onAdd({
        id: result.id,
        title: result.name,
        titleJp: result.name,
        titleRomaji: result.original || undefined,
        imageUrl,
        imageSexual: result.image_sexual ?? null,
      });
    }

    setQuery('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  }, [onAdd]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      const result = results[selectedIndex];
      if (result && !isItemInList(result.id)) {
        handleSelect(result);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }, [isOpen, results, selectedIndex, handleSelect, isItemInList]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Clear results when mode changes
  useEffect(() => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
  }, [mode]);

  const placeholder = isAtCapacity
    ? (mode === 'characters' ? s['search.charsCapacityPlaceholder'] : s['search.capacityPlaceholder'])
    : (mode === 'characters' ? s['search.charsPlaceholder'] : s['search.placeholder']);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          ref={inputRef}
          type="search"
          autoComplete="off"
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setIsOpen(true); }}
          placeholder={placeholder}
          disabled={isAtCapacity}
          role="combobox"
          aria-expanded={isOpen && results.length > 0}
          aria-autocomplete="list"
          aria-controls={isOpen ? 'tier-search-listbox' : undefined}
          aria-activedescendant={selectedIndex >= 0 ? `tier-search-option-${selectedIndex}` : undefined}
          aria-label={placeholder}
          className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 animate-spin" />
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div
          ref={dropdownRef}
          id="tier-search-listbox"
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg"
        >
          {results.map((result, i) => {
            const alreadyAdded = isItemInList(result.id);
            const isNsfw = result.image_sexual != null && result.image_sexual >= NSFW_THRESHOLD;
            const proxied = result.image_url
              ? getProxiedImageUrl(result.image_url, { width: 128, vnId: result.id })
              : null;
            const coverUrl = proxied && isNsfw ? getTinySrc(proxied) : proxied;

            return (
              <button
                key={result.id}
                id={`tier-search-option-${i}`}
                role="option"
                aria-selected={i === selectedIndex}
                onClick={() => !alreadyAdded && handleSelect(result)}
                disabled={alreadyAdded}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                  i === selectedIndex ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                } ${alreadyAdded ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer'}`}
              >
                {/* Cover thumbnail */}
                <div className="w-8 h-11 shrink-0 rounded overflow-hidden bg-gray-100 dark:bg-gray-700">
                  {coverUrl ? (
                    <img src={coverUrl} alt="" className="w-full h-full object-cover" style={isNsfw ? { imageRendering: 'pixelated' } : undefined} />
                  ) : (
                    <div className="w-full h-full" />
                  )}
                </div>

                {/* Title + info */}
                <div className="flex-1 min-w-0">
                  {isVNResult(result) ? (
                    <>
                      <div className="font-medium text-gray-900 dark:text-white truncate">
                        {displayTitle(result)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {result.released?.slice(0, 4) ?? 'TBA'}
                        {result.rating ? ` · ${(result.rating / 10).toFixed(2)}` : ''}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="font-medium text-gray-900 dark:text-white truncate">
                        {preference === 'romaji' && result.original ? result.original : result.name}
                        {result.original && result.name !== result.original && (
                          <span className="ml-1.5 text-gray-500 dark:text-gray-400 font-normal">
                            {preference === 'romaji' ? result.name : result.original}
                          </span>
                        )}
                      </div>
                      {result.vn_name && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {getDisplayTitle({ title: result.vn_name, title_jp: result.vn_title_jp, title_romaji: result.vn_title_romaji }, preference)}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Add indicator */}
                {alreadyAdded ? (
                  <span className="text-xs text-gray-400 shrink-0">{s['search.added']}</span>
                ) : (
                  <Plus className="w-4 h-4 text-gray-400 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {isError && !isLoading && results.length === 0 && query.length >= 2 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg px-3 py-2">
          <p className="text-sm text-red-400">{s['search.error']}</p>
        </div>
      )}
    </div>
  );
}
