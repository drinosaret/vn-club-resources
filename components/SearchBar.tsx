'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, FileText, Newspaper, X, Gamepad2, ArrowRight } from 'lucide-react';
import { searchContent, SearchResult } from '@/lib/search';
import { vndbStatsApi, VNSearchResult } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl, getTinySrc } from '@/lib/vndb-image-cache';
import { getDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import { stripBBCode } from '@/lib/bbcode';

// Maximum search query length to prevent ReDoS attacks
const MAX_QUERY_LENGTH = 100;
const VN_RESULT_LIMIT = 5;

interface SearchBarProps {
  className?: string;
  onClose?: () => void;
  isMobile?: boolean;
}

export default function SearchBar({ className = '', onClose, isMobile = false }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [guideResults, setGuideResults] = useState<SearchResult[]>([]);
  const [vnResults, setVnResults] = useState<VNSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prefetchedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const { preference } = useTitlePreference();

  // Total navigable items: guides + VNs + "See all VNs" link (if VN results exist)
  const totalItems = useMemo(() => {
    return guideResults.length + vnResults.length + (vnResults.length > 0 ? 1 : 0);
  }, [guideResults.length, vnResults.length]);

  // Prefetch search index on first focus for faster search
  const handleFocus = useCallback(() => {
    if (!prefetchedRef.current) {
      prefetchedRef.current = true;
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = '/search-index.json';
      link.as = 'fetch';
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }
  }, []);

  // Debounced search — guides + VNs in parallel
  useEffect(() => {
    if (!query.trim()) {
      setGuideResults([]);
      setVnResults([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    // Immediately show loading feedback while debounce + fetch runs
    setIsLoading(true);
    setIsOpen(true);

    const timeoutId = setTimeout(async () => {
      // Cancel any in-flight VN search
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const [guideSettled, vnSettled] = await Promise.allSettled([
          searchContent(query),
          vndbStatsApi.searchVNs(query, VN_RESULT_LIMIT, controller.signal),
        ]);

        // Don't update state if this request was aborted
        if (controller.signal.aborted) return;

        const guides = guideSettled.status === 'fulfilled' ? guideSettled.value : [];
        const vns = vnSettled.status === 'fulfilled' ? vnSettled.value.results : [];

        setGuideResults(guides);
        setVnResults(vns);
        setSelectedIndex(-1);
      } catch {
        if (!controller.signal.aborted) {
          setGuideResults([]);
          setVnResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 200);

    return () => {
      clearTimeout(timeoutId);
      abortRef.current?.abort();
    };
  }, [query]);

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

  const closeAndReset = useCallback(() => {
    setQuery('');
    setIsOpen(false);
    setGuideResults([]);
    setVnResults([]);
    onClose?.();
  }, [onClose]);

  const navigateToGuide = useCallback((result: SearchResult) => {
    router.push(`/${result.slug}`);
    closeAndReset();
  }, [router, closeAndReset]);

  const navigateToVN = useCallback((vn: VNSearchResult) => {
    const vnId = vn.id.startsWith('v') ? vn.id : `v${vn.id}`;
    router.push(`/vn/${vnId}/`);
    closeAndReset();
  }, [router, closeAndReset]);

  const navigateToBrowse = useCallback(() => {
    router.push(`/browse/?q=${encodeURIComponent(query.trim())}`);
    closeAndReset();
  }, [router, query, closeAndReset]);

  // Map flat selectedIndex to the correct section/action
  const handleSelect = useCallback((index: number) => {
    if (index < 0) return;

    if (index < guideResults.length) {
      navigateToGuide(guideResults[index]);
    } else if (index < guideResults.length + vnResults.length) {
      navigateToVN(vnResults[index - guideResults.length]);
    } else {
      // "See all visual novels" link
      navigateToBrowse();
    }
  }, [guideResults, vnResults, navigateToGuide, navigateToVN, navigateToBrowse]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || totalItems === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < totalItems - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : totalItems - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          handleSelect(selectedIndex);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        inputRef.current?.blur();
        break;
    }
  }, [isOpen, totalItems, selectedIndex, handleSelect]);

  const clearSearch = () => {
    setQuery('');
    setGuideResults([]);
    setVnResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const highlightMatch = (text: string, searchQuery: string) => {
    // Validate inputs to prevent ReDoS
    const trimmedQuery = searchQuery.trim().slice(0, MAX_QUERY_LENGTH);
    if (!trimmedQuery) return text;

    // Escape regex special characters
    const escapedQuery = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let regex = new RegExp(`(${escapedQuery})`, 'gi');
    let parts = text.split(regex);

    // If no exact match, try normalized match: allow separators between characters
    // so "muvluv" highlights "Muv-Luv", "steinsgate" highlights "Steins;Gate", etc.
    if (parts.length <= 1) {
      const alphanumOnly = trimmedQuery.replace(/[^a-zA-Z0-9]/g, '');
      if (alphanumOnly.length >= 2) {
        const fuzzyPattern = alphanumOnly
          .split('')
          .map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^a-zA-Z0-9]*');
        regex = new RegExp(`(${fuzzyPattern})`, 'gi');
        parts = text.split(regex);
      }
    }

    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 text-inherit rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const hasResults = guideResults.length > 0 || vnResults.length > 0;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        {isLoading ? (
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 border-t-indigo-500 dark:border-t-indigo-400 rounded-full animate-spin" />
          </div>
        ) : (
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value.slice(0, MAX_QUERY_LENGTH))}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            handleFocus(); // Prefetch search index on first focus
            query.trim() && (hasResults || isLoading) && setIsOpen(true);
          }}
          placeholder="Search..."
          className={`
            w-full pl-9 pr-8 py-2
            bg-gray-100 dark:bg-gray-800
            border border-gray-200 dark:border-gray-700
            rounded-lg
            text-sm text-gray-900 dark:text-gray-100
            placeholder-gray-500 dark:placeholder-gray-400
            focus:outline-none transition-colors
            ${isMobile
              ? 'text-base focus:border-gray-400 dark:focus:border-gray-600'
              : 'focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent'
            }
          `}
          aria-label="Search"
          aria-expanded={isOpen}
          aria-controls="search-results"
          role="combobox"
          aria-autocomplete="list"
        />
        {query && (
          <button
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {isOpen && (
        <div
          id="search-results"
          role="listbox"
          className={`
            absolute z-50 mt-2
            bg-white dark:bg-gray-900
            shadow-lg
            max-h-[28rem] overflow-y-auto
            ${isMobile
              ? '-mx-4 w-[calc(100%+2rem)] rounded-b-lg border-b border-gray-200 dark:border-gray-700'
              : 'w-full min-w-[420px] rounded-lg border border-gray-200 dark:border-gray-700'
            }
          `}
        >
          {isLoading && !hasResults ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              <div className="inline-block w-4 h-4 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin mr-2" />
              Searching...
            </div>
          ) : !isLoading && !hasResults ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              No results found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <div>
              {/* Guide results */}
              {guideResults.length > 0 && (
                <div>
                  {vnResults.length > 0 && (
                    <div className="px-4 pt-2.5 pb-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Guides
                    </div>
                  )}
                  <ul className={vnResults.length > 0 ? 'pb-1' : 'py-2'}>
                    {guideResults.map((result, index) => (
                      <li key={result.id}>
                        <button
                          onClick={() => navigateToGuide(result)}
                          onMouseEnter={() => setSelectedIndex(index)}
                          role="option"
                          aria-selected={index === selectedIndex}
                          className={`
                            w-full px-4 py-3 text-left
                            hover:bg-gray-100 dark:hover:bg-gray-800
                            focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-800
                            border-b border-gray-100 dark:border-gray-800 last:border-b-0
                            ${index === selectedIndex ? 'bg-gray-100 dark:bg-gray-800' : ''}
                          `}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 mt-0.5">
                              {result.type === 'guide' ? (
                                <FileText className="w-4 h-4 text-indigo-500" />
                              ) : (
                                <Newspaper className="w-4 h-4 text-purple-500" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                                {highlightMatch(result.title, query)}
                              </div>
                              {result.section && (
                                <div className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">
                                  in section: {result.section}
                                </div>
                              )}
                              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                                {highlightMatch(result.excerpt, query)}
                              </div>
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* VN results */}
              {vnResults.length > 0 && (
                <div className={guideResults.length > 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''}>
                  <div className="px-4 pt-2.5 pb-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Visual Novels
                  </div>
                  <ul className="pb-1">
                    {vnResults.map((vn, index) => {
                      const flatIndex = guideResults.length + index;
                      const vnId = vn.id.startsWith('v') ? vn.id : `v${vn.id}`;
                      const isNsfw = vn.image_sexual != null && vn.image_sexual >= 1.5;
                      const proxied = vn.image_url ? getProxiedImageUrl(vn.image_url, { width: 128, vnId }) : null;
                      const imageUrl = proxied && isNsfw ? getTinySrc(proxied) : proxied;
                      const displayTitle = getDisplayTitle(vn, preference);
                      // Show the "other" title as subtitle (JP when showing romaji, romaji when showing JP)
                      const subtitle = (preference === 'japanese'
                        ? (vn.title_romaji || vn.title || '')
                        : (vn.title_jp || '')
                      ).replace(/\\n|\n/g, ' ').replace(/\s+/g, ' ').trim();

                      return (
                        <li key={vn.id}>
                          <button
                            onClick={() => navigateToVN(vn)}
                            onMouseEnter={() => setSelectedIndex(flatIndex)}
                            role="option"
                            aria-selected={flatIndex === selectedIndex}
                            className={`
                              w-full px-4 py-2.5 text-left
                              hover:bg-gray-100 dark:hover:bg-gray-800
                              focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-800
                              border-b border-gray-100 dark:border-gray-800 last:border-b-0
                              ${flatIndex === selectedIndex ? 'bg-gray-100 dark:bg-gray-800' : ''}
                            `}
                          >
                            <div className="flex items-start gap-3">
                              {/* Thumbnail */}
                              <div className="flex-shrink-0 w-10 h-14 rounded overflow-hidden bg-gray-200 dark:bg-gray-700">
                                {imageUrl ? (
                                  <img
                                    src={imageUrl}
                                    alt={displayTitle}
                                    className="w-full h-full object-cover opacity-0 transition-opacity duration-200"
                                    style={isNsfw ? { imageRendering: 'pixelated' } : undefined}
                                    loading="lazy"
                                    onLoad={(e) => { (e.target as HTMLImageElement).classList.remove('opacity-0'); }}
                                    onError={(e) => { (e.target as HTMLImageElement).classList.remove('opacity-0'); }}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Gamepad2 className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                                  </div>
                                )}
                              </div>

                              {/* Details */}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                                  {highlightMatch(displayTitle, query)}
                                </div>
                                {subtitle && subtitle !== displayTitle && (
                                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                    {subtitle}
                                  </div>
                                )}
                                <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                  {vn.rating != null && (
                                    <span className="text-yellow-600 dark:text-yellow-400">
                                      ★ {vn.rating.toFixed(1)}
                                    </span>
                                  )}
                                  {vn.released && (
                                    <span>{vn.released.slice(0, 4)}</span>
                                  )}
                                </div>
                                {vn.description && (
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                                    {stripBBCode(vn.description).replace(/\n/g, ' ')}
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {/* "See all visual novels" link */}
                  <button
                    onClick={navigateToBrowse}
                    onMouseEnter={() => setSelectedIndex(guideResults.length + vnResults.length)}
                    role="option"
                    aria-selected={selectedIndex === guideResults.length + vnResults.length}
                    className={`
                      w-full px-4 py-2.5 text-left text-sm
                      text-indigo-600 dark:text-indigo-400
                      hover:bg-gray-100 dark:hover:bg-gray-800
                      focus:outline-none
                      border-t border-gray-200 dark:border-gray-700
                      flex items-center gap-2
                      ${selectedIndex === guideResults.length + vnResults.length ? 'bg-gray-100 dark:bg-gray-800' : ''}
                    `}
                  >
                    <Search className="w-3.5 h-3.5" />
                    Search all visual novels for &ldquo;{query}&rdquo;
                    <ArrowRight className="w-3.5 h-3.5 ml-auto" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
