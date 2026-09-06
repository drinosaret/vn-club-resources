'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Search, X, Loader2, Plus } from 'lucide-react';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { VNSearchResult, CharacterSearchResult } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl, getTinySrc } from '@/lib/vndb-image-cache';
import { getDisplayTitle, useDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import { useNSFWRevealContext, NSFW_THRESHOLD } from '@/lib/nsfw-reveal';
import { useLocale } from '@/lib/i18n/locale-context';
import { gridMakerStrings } from '@/lib/i18n/translations/grid-maker';
import { t } from '@/lib/i18n/types';
import type { GridItem, GridMode } from '@/hooks/useGridMakerState';

type SearchResult = VNSearchResult | CharacterSearchResult;

function isVNResult(result: SearchResult): result is VNSearchResult {
  return 'title' in result && !('vn_name' in result);
}

interface CellFillModalProps {
  cellIndex: number;
  mode: GridMode;
  pool: string[];
  cells: (string | null)[];
  itemMap: Record<string, GridItem>;
  onSelect: (item: GridItem) => void;
  onSelectFromPool: (itemId: string) => void;
  onClose: () => void;
}

export function CellFillModal({
  cellIndex,
  mode,
  pool,
  cells,
  itemMap,
  onSelect,
  onSelectFromPool,
  onClose,
}: CellFillModalProps) {
  const locale = useLocale();
  const s = gridMakerStrings[locale];
  const displayTitle = useDisplayTitle();
  const { preference } = useTitlePreference();
  const nsfwContext = useNSFWRevealContext();
  const nsfwRevealed = nsfwContext?.allRevealed ?? false;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isError, setIsError] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    // Small delay to ensure modal is rendered
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const search = useCallback(async (q: string) => {
    if (abortRef.current) abortRef.current.abort();
    if (q.length < 2) {
      setResults([]);
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
        const idMatch = q.trim().match(/^v?(\d+)$/i);
        const [searchRes, idRes] = await Promise.all([
          vndbStatsApi.searchVNs(q, 10, controller.signal, null, true),
          idMatch ? vndbStatsApi.getVN(`v${idMatch[1]}`) : null,
        ]);
        searchResults = searchRes.results;
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

  const poolSet = useMemo(() => new Set(pool), [pool]);
  const cellSet = useMemo(() => new Set(cells.filter(Boolean) as string[]), [cells]);

  // Filter pool items by query
  const filteredPool = useMemo(() => {
    if (query.length < 2) return pool;
    const q = query.toLowerCase();
    return pool.filter(itemId => {
      const item = itemMap[itemId];
      if (!item) return false;
      return (item.title?.toLowerCase().includes(q))
        || (item.titleJp?.toLowerCase().includes(q))
        || (item.titleRomaji?.toLowerCase().includes(q))
        || (item.customTitle?.toLowerCase().includes(q))
        || itemId.toLowerCase().includes(q);
    });
  }, [pool, itemMap, query]);

  // Filter out pool items from search results to avoid duplicates
  const filteredResults = useMemo(() => {
    if (filteredPool.length === 0) return results;
    const poolIds = new Set(filteredPool);
    return results.filter(r => !poolIds.has(r.id));
  }, [results, filteredPool]);

  // Total selectable items for keyboard nav: filtered pool + filtered results
  const totalItems = filteredPool.length + filteredResults.length;

  const handleSelectResult = useCallback((result: SearchResult) => {
    // If it's in the pool, select from pool instead
    if (poolSet.has(result.id)) {
      onSelectFromPool(result.id);
      return;
    }
    if (isVNResult(result)) {
      const imageUrl = result.image_url
        ? getProxiedImageUrl(result.image_url, { width: 256, vnId: result.id })
        : null;
      onSelect({
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
      const imageUrl = result.image_url
        ? getProxiedImageUrl(result.image_url, { width: 256, vnId: result.id })
        : null;
      onSelect({
        id: result.id,
        title: result.name,
        titleJp: result.name,
        titleRomaji: result.original || undefined,
        imageUrl,
        imageSexual: result.image_sexual ?? null,
      });
    }
  }, [onSelect, onSelectFromPool, poolSet]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (totalItems === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, totalItems - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      if (selectedIndex < filteredPool.length) {
        onSelectFromPool(filteredPool[selectedIndex]);
      } else {
        const result = filteredResults[selectedIndex - filteredPool.length];
        if (result && !cellSet.has(result.id)) {
          handleSelectResult(result);
        }
      }
    }
  }, [totalItems, selectedIndex, filteredPool, filteredResults, handleSelectResult, onSelectFromPool, cellSet]);

  const showPoolSection = filteredPool.length > 0;

  return (
    <div className="toy-scrim">
      {/* Backdrop */}
      <div className="toy-scrim-fill" onClick={onClose} />

      {/* Modal */}
      <div
        ref={modalRef}
        className="toy-modal toy-modal--sm"
        role="dialog"
        aria-modal="true"
        aria-label={t(s, mode === 'characters' ? 'search.cellTargetChars' : 'search.cellTargetVNs', { n: cellIndex + 1 })}
      >
        {/* Header with search */}
        <div className="toy-modal-head">
          <Search className="w-4 h-4 shrink-0 text-[color:var(--nezu)]" />
          <input
            ref={inputRef}
            type="search"
            autoComplete="off"
            value={query}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t(s, mode === 'characters' ? 'search.cellTargetChars' : 'search.cellTargetVNs', { n: cellIndex + 1 })}
            className="toy-field toy-field--bare flex-1 min-w-0"
          />
          {isLoading && <Loader2 className="w-4 h-4 shrink-0 animate-spin text-[color:var(--nezu)]" />}
          <button onClick={onClose} className="toy-x" aria-label={s['crop.cancel']}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results / Pool */}
        <div className="max-h-[50vh] overflow-y-auto">
          {/* Pool items (filtered when searching) */}
          {showPoolSection && (
            <div>
              <div className="toy-opt-group">
                {s['pool.label']} ({filteredPool.length})
              </div>
              {filteredPool.map((itemId, i) => {
                const item = itemMap[itemId];
                if (!item) return null;
                const title = item.customTitle
                  || ((item.titleJp || item.titleRomaji)
                    ? getDisplayTitle({ title: item.title, title_jp: item.titleJp, title_romaji: item.titleRomaji }, preference)
                    : item.title);
                const isNsfw = !nsfwRevealed && (item.imageSexual ?? 0) >= NSFW_THRESHOLD;
                const imgSrc = item.imageUrl
                  ? (isNsfw ? getTinySrc(item.imageUrl) : item.imageUrl)
                  : null;
                return (
                  <button
                    key={itemId}
                    onClick={() => onSelectFromPool(itemId)}
                    className={`toy-opt ${i === selectedIndex ? 'toy-opt--focus' : ''}`}
                  >
                    <div className="toy-thumb w-8 h-11">
                      {imgSrc ? (
                        <img
                          src={imgSrc}
                          alt=""
                          className="w-full h-full object-cover"
                          style={isNsfw ? { imageRendering: 'pixelated' } : undefined}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="w-full h-full" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{title}</div>
                      {mode !== 'characters' && (item.released || item.rating) && (
                        <div className="font-mono text-xs tabular-nums text-[color:var(--nezu)]">
                          {item.released?.slice(0, 4) ?? 'TBA'}
                          {item.rating ? ` · ${item.rating.toFixed(2)}` : ''}
                        </div>
                      )}
                    </div>
                    <Plus className="w-4 h-4 shrink-0 text-[color:var(--nezu)]" />
                  </button>
                );
              })}
            </div>
          )}

          {/* Search results (excluding items already shown in pool section) */}
          {filteredResults.length > 0 && (
            <div>
              {showPoolSection && (
                <div className="toy-opt-group">
                  {mode === 'characters' ? s['toolbar.characters'] : s['toolbar.vns']}
                </div>
              )}
              {filteredResults.map((result, i) => {
                const inCell = cellSet.has(result.id);
                const inPool = poolSet.has(result.id);
                const globalIdx = filteredPool.length + i;
                const isNsfw = !nsfwRevealed && result.image_sexual != null && result.image_sexual >= NSFW_THRESHOLD;
                const proxied = result.image_url
                  ? getProxiedImageUrl(result.image_url, { width: 128, vnId: result.id })
                  : null;
                const imageUrl = proxied && isNsfw ? getTinySrc(proxied) : proxied;

                return (
                  <button
                    key={result.id}
                    onClick={() => {
                      if (inCell) return;
                      if (inPool) { onSelectFromPool(result.id); return; }
                      handleSelectResult(result);
                    }}
                    disabled={inCell}
                    className={`toy-opt ${globalIdx === selectedIndex ? 'toy-opt--focus' : ''}`}
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

                    {inCell ? (
                      <span className="toy-label shrink-0">{s['search.added']}</span>
                    ) : inPool ? (
                      <span className="toy-label shrink-0 text-[color:var(--kohaku-text)]">{s['pool.label']}</span>
                    ) : (
                      <Plus className="w-4 h-4 shrink-0 text-[color:var(--nezu)]" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Error state */}
          {isError && !isLoading && query.length >= 2 && filteredPool.length === 0 && filteredResults.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-[color:var(--beni-text)]">
              {s['search.error']}
            </div>
          )}

          {/* Empty state */}
          {query.length >= 2 && filteredPool.length === 0 && filteredResults.length === 0 && !isLoading && !isError && (
            <div className="px-4 py-8 text-center text-sm text-[color:var(--nezu)]">
              {s['search.noResults']}
            </div>
          )}

          {/* Empty: no pool, no query */}
          {!showPoolSection && query.length < 2 && (
            <div className="px-4 py-8 text-center text-sm text-[color:var(--nezu)]">
              {mode === 'characters' ? s['search.charsPlaceholder'] : s['search.vnsPlaceholder']}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
