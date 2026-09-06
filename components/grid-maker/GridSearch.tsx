'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { VNSearchResult, CharacterSearchResult } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl, getTinySrc } from '@/lib/vndb-image-cache';
import { getDisplayTitle, useDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import { useNSFWRevealContext, NSFW_THRESHOLD } from '@/lib/nsfw-reveal';
import { useLocale } from '@/lib/i18n/locale-context';
import { gridMakerStrings } from '@/lib/i18n/translations/grid-maker';
import type { GridItem, GridMode } from '@/hooks/useGridMakerState';

type SearchResult = VNSearchResult | CharacterSearchResult;

interface GridSearchProps {
  mode: GridMode;
  onAdd: (item: GridItem) => void;
  isItemAdded: (itemId: string) => boolean;
  isAtCapacity?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function isVNResult(result: SearchResult): result is VNSearchResult {
  return 'title' in result && !('vn_name' in result);
}

export function GridSearch({ mode, onAdd, isItemAdded, isAtCapacity, inputRef }: GridSearchProps) {
  const locale = useLocale();
  const s = gridMakerStrings[locale];
  const displayTitle = useDisplayTitle();
  const { preference } = useTitlePreference();
  const nsfwContext = useNSFWRevealContext();
  const nsfwRevealed = nsfwContext?.allRevealed ?? false;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isError, setIsError] = useState(false);

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
        // A VNDB character id ("c123", or the bare number) reaches the one character it
        // names even when its name is shared by dozens and the list is cut short.
        const charIdMatch = q.trim().match(/^c?(\d+)$/i);
        const [charRes, charById] = await Promise.all([
          vndbStatsApi.searchCharacters(q, 10, controller.signal),
          charIdMatch ? vndbStatsApi.getCharacter(`c${charIdMatch[1]}`) : null,
        ]);
        searchResults = charRes.results;
        if (charById && !searchResults.some((r) => r.id === charById.id)) {
          const shown = charById.vns?.find((vn) => vn.role === 'main') ?? charById.vns?.[0];
          searchResults = [{
            id: charById.id,
            name: charById.name,
            original: charById.original ?? undefined,
            image_url: charById.image_url ?? undefined,
            image_sexual: charById.image_sexual ?? undefined,
            vn_id: shown?.id ?? undefined,
            vn_name: shown?.title ?? undefined,
            vn_title_jp: shown?.title_jp ?? undefined,
            vn_title_romaji: shown?.title_romaji ?? undefined,
          }, ...searchResults];
        }
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
        ? getProxiedImageUrl(result.image_url, { width: 256, vnId: result.id })
        : null;
      onAdd({
        id: result.id,
        title: result.title,
        titleJp: result.title_jp,
        titleRomaji: result.title_romaji,
        imageUrl,
        imageSexual: result.image_sexual ?? null,
        released: result.released ?? null,
        rating: result.rating ?? null,
      });
    } else {
      // Character result
      const imageUrl = result.image_url
        ? getProxiedImageUrl(result.image_url, { width: 256, vnId: result.id })
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
  }, [onAdd, inputRef]);

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
      if (result && !isItemAdded(result.id)) {
        handleSelect(result);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }, [isOpen, results, selectedIndex, handleSelect, isItemAdded]);

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
  }, [inputRef]);

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
    : mode === 'characters'
      ? s['search.charsPlaceholder']
      : s['search.vnsPlaceholder'];

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[color:var(--nezu)] pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          autoComplete="off"
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isAtCapacity}
          onFocus={() => { if (results.length > 0) setIsOpen(true); }}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={isOpen && results.length > 0}
          aria-autocomplete="list"
          aria-controls={isOpen ? 'grid-search-listbox' : undefined}
          aria-activedescendant={selectedIndex >= 0 ? `grid-search-option-${selectedIndex}` : undefined}
          aria-label={placeholder}
          className="toy-field toy-field--search w-full"
        />
        {isLoading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[color:var(--nezu)] animate-spin" />
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div
          ref={dropdownRef}
          id="grid-search-listbox"
          role="listbox"
          className="toy-menu absolute z-50 mt-1 w-full max-h-64 overflow-y-auto"
        >
          {results.map((result, i) => {
            const alreadyAdded = isItemAdded(result.id);
            const isNsfw = !nsfwRevealed && result.image_sexual != null && result.image_sexual >= NSFW_THRESHOLD;
            const proxied = result.image_url
              ? getProxiedImageUrl(result.image_url, { width: 128, vnId: result.id })
              : null;
            const imageUrl = proxied && isNsfw ? getTinySrc(proxied) : proxied;

            return (
              <button
                key={result.id}
                id={`grid-search-option-${i}`}
                role="option"
                aria-selected={i === selectedIndex}
                onClick={() => !alreadyAdded && handleSelect(result)}
                disabled={alreadyAdded}
                className={`toy-opt ${i === selectedIndex ? 'toy-opt--focus' : ''}`}
              >
                <div className="toy-thumb w-8 h-11">
                  {imageUrl ? (
                    <img src={imageUrl} alt="" className="w-full h-full object-cover" style={isNsfw ? { imageRendering: 'pixelated' } : undefined} />
                  ) : (
                    <div className="w-full h-full" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {isVNResult(result) ? (
                    <>
                      <div className="font-medium truncate">
                        {displayTitle(result)}
                      </div>
                      <div className="font-mono text-xs tabular-nums text-[color:var(--nezu)]">
                        {result.released?.slice(0, 4) ?? 'TBA'}
                        {result.rating ? ` · ${result.rating.toFixed(2)}` : ''}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="font-medium truncate">
                        {preference === 'romaji' && result.original ? result.original : result.name}
                        {result.original && result.name !== result.original && (
                          <span className="ml-1.5 font-normal text-[color:var(--nezu)]">
                            {preference === 'romaji' ? result.name : result.original}
                          </span>
                        )}
                      </div>
                      {result.vn_name && (
                        <div className="truncate text-xs text-[color:var(--nezu)]">
                          {getDisplayTitle({ title: result.vn_name, title_jp: result.vn_title_jp, title_romaji: result.vn_title_romaji }, preference)}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {alreadyAdded ? (
                  <span className="toy-label shrink-0">{s['search.added']}</span>
                ) : (
                  <Plus className="w-4 h-4 shrink-0 text-[color:var(--nezu)]" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {isError && !isLoading && results.length === 0 && query.length >= 2 && (
        <div className="bw-alert absolute z-50 mt-1 w-full px-3 py-2">
          <p className="text-sm">{s['search.error']}</p>
        </div>
      )}
    </div>
  );
}
