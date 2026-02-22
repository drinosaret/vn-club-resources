'use client';

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, startTransition, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Search, Loader2, X, AlertCircle, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { mutate } from 'swr';
import { vndbStatsApi, VNSearchResult, BrowseFilters, BrowseResponse } from '@/lib/vndb-stats-api';
import { useTitlePreference } from '@/lib/title-preference';
import { VNGrid, GRID_IMAGE_WIDTHS } from './VNGrid';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { Pagination, PaginationSkeleton } from './Pagination';
import { TagFilter, SelectedTag, FilterEntityType } from './TagFilter';
import { ViewModeToggle, GridSize } from './ViewModeToggle';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { consumePendingScroll } from '@/components/ScrollToTop';
import { CompactFilterBar } from './CompactFilterBar';
import { ActiveFilterChips } from './ActiveFilterChips';
import { InlineRangeSliders } from './InlineRangeSliders';
import { MobileFilterPanel } from './MobileFilterPanel';
import { SidebarFilters } from './SidebarFilters';
import { AlphabetFilter } from './AlphabetFilter';
import { BrowseTabs, BrowseTab } from './BrowseTabs';
import { SimpleSelect } from './SimpleSelect';
import { RandomButton } from './RandomButton';

// Skeleton fallback for entity tabs — matches the structure of the real tab content
// (search bar + filter + alphabet row + results header + pagination + table + pagination)
const TabLoadingFallback = () => (
  <div className="space-y-4">
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="flex-1 h-10 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
      <div className="flex gap-2">
        <div className="w-32 h-10 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
      </div>
    </div>
    <div className="h-9 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
    <div className="flex items-center justify-between">
      <div className="w-24 h-5 bg-gray-100 dark:bg-gray-800 rounded-sm animate-pulse" />
      <div className="flex gap-2">
        <div className="w-28 h-8 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
        <div className="w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
      </div>
    </div>
    <PaginationSkeleton />
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {[...Array(10)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
          <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-800 rounded-sm animate-pulse" />
          <div className="w-16 h-4 bg-gray-100 dark:bg-gray-800 rounded-sm animate-pulse" />
          <div className="w-20 h-4 bg-gray-100 dark:bg-gray-800 rounded-sm animate-pulse" />
        </div>
      ))}
    </div>
    <PaginationSkeleton />
  </div>
);

const BrowseTagsTab = dynamic(
  () => import('./BrowseTagsTab').then(m => ({ default: m.BrowseTagsTab })),
  { loading: TabLoadingFallback, ssr: false }
);
const BrowseTraitsTab = dynamic(
  () => import('./BrowseTraitsTab').then(m => ({ default: m.BrowseTraitsTab })),
  { loading: TabLoadingFallback, ssr: false }
);
const BrowseStaffTab = dynamic(
  () => import('./BrowseStaffTab').then(m => ({ default: m.BrowseStaffTab })),
  { loading: TabLoadingFallback, ssr: false }
);
const BrowseSeiyuuTab = dynamic(
  () => import('./BrowseSeiyuuTab').then(m => ({ default: m.BrowseSeiyuuTab })),
  { loading: TabLoadingFallback, ssr: false }
);
const BrowseProducerTab = dynamic(
  () => import('./BrowseProducerTab').then(m => ({ default: m.BrowseProducerTab })),
  { loading: TabLoadingFallback, ssr: false }
);

// Preload tab chunks on hover — raw imports trigger chunk download before click
const TAB_PRELOADERS: Partial<Record<BrowseTab, () => void>> = {
  tags: () => { import('./BrowseTagsTab'); },
  traits: () => { import('./BrowseTraitsTab'); },
  staff: () => { import('./BrowseStaffTab'); },
  seiyuu: () => { import('./BrowseSeiyuuTab'); },
  producers: () => { import('./BrowseProducerTab'); },
};

// Items per page based on grid size to ensure complete rows at xl breakpoint
const ITEMS_PER_PAGE: Record<GridSize, number> = {
  small: 42,   // 6 cols × 7 rows at xl
  medium: 35,  // 5 cols × 7 rows at xl
  large: 28,   // 4 cols × 7 rows at xl
};

/** Parse browse filters from URL search params. Used for both initial mount and
 *  back-navigation recovery (where window.location.search is more reliable than
 *  useSearchParams which may return stale cached RSC values). */
function parseFiltersFromParams(params: URLSearchParams, limit: number): BrowseFilters {
  return {
    q: params.get('q') || undefined,
    first_char: params.get('first_char') || undefined,
    tags: params.get('tags') || undefined,
    exclude_tags: params.get('exclude_tags') || undefined,
    traits: params.get('traits') || undefined,
    exclude_traits: params.get('exclude_traits') || undefined,
    tag_mode: (params.get('tag_mode') as 'and' | 'or') || 'and',
    include_children: params.has('include_children') ? params.get('include_children') === 'true' : true,
    year_min: params.get('year_min') ? Number(params.get('year_min')) : undefined,
    year_max: params.get('year_max') ? Number(params.get('year_max')) : undefined,
    min_rating: params.get('min_rating') ? Number(params.get('min_rating')) : undefined,
    max_rating: params.get('max_rating') ? Number(params.get('max_rating')) : undefined,
    min_votecount: params.get('min_votecount') ? Number(params.get('min_votecount')) : undefined,
    max_votecount: params.get('max_votecount') ? Number(params.get('max_votecount')) : undefined,
    length: params.get('length') || undefined,
    exclude_length: params.get('exclude_length') || undefined,
    minage: params.get('minage') || undefined,
    exclude_minage: params.get('exclude_minage') || undefined,
    devstatus: params.get('devstatus') || '-1',
    exclude_devstatus: params.get('exclude_devstatus') || undefined,
    olang: params.has('olang') ? (params.get('olang') || undefined) : 'ja',
    exclude_olang: params.get('exclude_olang') || undefined,
    platform: params.get('platform') || undefined,
    exclude_platform: params.get('exclude_platform') || undefined,
    spoiler_level: params.get('spoiler_level') ? Number(params.get('spoiler_level')) : 0,
    staff: params.get('staff') || undefined,
    seiyuu: params.get('seiyuu') || undefined,
    developer: params.get('developer') || undefined,
    publisher: params.get('publisher') || undefined,
    producer: params.get('producer') || undefined,
    sort: (params.get('sort') as BrowseFilters['sort']) || 'rating',
    sort_order: (params.get('sort_order') as 'asc' | 'desc') || 'desc',
    page: params.get('page') ? Number(params.get('page')) : 1,
    limit,
  };
}

// Helper to parse tag/trait/entity names from URL (stored as "type:id:name,type:id:name")
function parseTagsFromUrl(param: string | null, mode: 'include' | 'exclude'): SelectedTag[] {
  if (!param) return [];
  try {
    return param.split(',').map((item) => {
      const [type, id, ...nameParts] = item.split(':');
      return {
        id: id,
        name: nameParts.join(':'),
        mode,
        type: type as FilterEntityType,
      };
    });
  } catch {
    return [];
  }
}

const TAB_TITLES: Record<BrowseTab, string> = {
  novels: 'Browse Visual Novels',
  tags: 'Browse Tags',
  traits: 'Browse Traits',
  staff: 'Browse Staff',
  seiyuu: 'Browse Seiyuu',
  producers: 'Browse Producers',
};

// Props for SSR support
export interface BrowsePageClientProps {
  /** Initial data from server-side fetch (null if fetch failed or non-novels tab) */
  initialData: BrowseResponse | null;
  /** Initial search params from the server component */
  initialSearchParams: { [key: string]: string | string[] | undefined };
  /** Grid size read from cookie on the server — SSR data uses this limit */
  serverGridSize?: GridSize;
}

export default function BrowsePageClient({ initialData, initialSearchParams, serverGridSize = 'small' }: BrowsePageClientProps) {
  const searchParams = useSearchParams();
  const { preference } = useTitlePreference();

  // Tab state — local state for instant switching, synced from URL on mount/popstate
  const urlTab = (searchParams.get('tab') as BrowseTab) || 'novels';
  const [activeTab, setActiveTab] = useState<BrowseTab>(urlTab);

  // Sync local state when URL changes (back/forward navigation)
  useEffect(() => {
    setActiveTab(urlTab);
  }, [urlTab]);

  const handleTabChange = useCallback((tab: BrowseTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams();
    if (tab !== 'novels') {
      params.set('tab', tab);
    }
    lastInternalQueryRef.current = params.toString();
    const url = `/browse/${params.toString() ? `?${params.toString()}` : ''}`;
    // Wrap in startTransition so React treats the resulting useSearchParams()
    // update as non-urgent and keeps old content visible (no Suspense flash).
    startTransition(() => {
      window.history.pushState(null, '', url);
    });
  }, []);

  const handleTabHover = useCallback((tab: BrowseTab) => {
    TAB_PRELOADERS[tab]?.();
  }, []);

  // Parse initial state from URL (default: Japanese VNs only).
  // Only computed once on mount — these seed useState/useRef and mount-time effects.
  // Using [] deps is intentional: searchParams is correct on first render, and internal
  // URL updates (replaceState) must NOT cause these to recompute (avoids cascading
  // re-renders that cause content flashes on Firefox under load).
  const initialFilters = useMemo(
    () => parseFiltersFromParams(searchParams, ITEMS_PER_PAGE[serverGridSize]),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Parse tags from URL — computed once on mount (same rationale as initialFilters)
  const initialTags = useMemo(() => {
    const includeTags = parseTagsFromUrl(searchParams.get('tag_names'), 'include');
    const excludeTags = parseTagsFromUrl(searchParams.get('exclude_tag_names'), 'exclude');
    return [...includeTags, ...excludeTags];
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // State - initialize from SSR data if available
  const [filters, setFilters] = useState<BrowseFilters>(initialFilters);
  const [searchInput, setSearchInput] = useState(initialFilters.q || '');
  const [results, setResults] = useState<VNSearchResult[]>(initialData?.results ?? []);
  const [total, setTotal] = useState(initialData?.total ?? 0);
  const [totalWithSpoilers, setTotalWithSpoilers] = useState<number | null>(initialData?.total_with_spoilers ?? null);
  const [databaseTotal, setDatabaseTotal] = useState<number | null>(null); // Total VNs in database (doesn't change)
  const [tagsTotal, setTagsTotal] = useState<number | null>(null);
  const [traitsTotal, setTraitsTotal] = useState<number | null>(null);
  const [staffTotal, setStaffTotal] = useState<number | null>(null);
  const [seiyuuTotal, setSeiyuuTotal] = useState<number | null>(null);
  const [producersTotal, setProducersTotal] = useState<number | null>(null);
  const [pages, setPages] = useState(initialData?.pages ?? 0);
  const [queryTime, setQueryTime] = useState<number | undefined>(initialData?.query_time);
  const [displayedQueryTime, setDisplayedQueryTime] = useState<number | undefined>(initialData?.query_time); // Stable display value
  const [isLoading, setIsLoading] = useState(!initialData); // Only loading if no SSR data
  const [isPaginatingOnly, setIsPaginatingOnly] = useState(false); // True when only page changed, not filters
  const [skipPreload, setSkipPreload] = useState(false); // True during pagination — VNGrid shows results immediately
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false); // Delayed overlay for filter/search changes
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<SelectedTag[]>(initialTags);
  // Key to force VNGrid remount on back navigation — clears its internal displayResults
  // buffer which otherwise keeps showing stale covers during the refetch.
  const [gridKey, setGridKey] = useState(0);
  // Initialize from server-known grid size — SSR data already uses this limit,
  // so server and client render identically. No useLayoutEffect needed.
  const [gridSize, setGridSizeState] = useState<GridSize>(serverGridSize);
  // On mount: sync grid size from localStorage and restore/refetch on back navigation.
  // Two problems this solves:
  // 1. Stale RSC cache: user changes to medium, clicks a VN, presses back → cached
  //    RSC payload still has serverGridSize='small' with wrong limit/data.
  // 2. Stale initialData: cached RSC has data from the FIRST /browse/ visit (page 1,
  //    default filters) but the URL has the user's actual state (page 3, filters, etc.).
  // First tries to restore from a sessionStorage snapshot (saved on VN link click) for
  // instant back navigation. Falls back to refetching if no snapshot is available.
  // useLayoutEffect runs before paint — prevents flash of stale covers on back navigation.
  const didRestoreSnapshotRef = useRef(false);
  useLayoutEffect(() => {
    // Read actual grid size from localStorage (always current, unlike cached serverGridSize)
    let actualGridSize: GridSize = gridSize;
    try {
      const stored = localStorage.getItem('browse-grid-size');
      if (stored && (stored === 'small' || stored === 'medium' || stored === 'large')) {
        actualGridSize = stored;
        if (stored !== gridSize) {
          setGridSizeState(stored);
        }
      }
    } catch {}

    // On back navigation, cached initialData is likely stale — restore or refetch.
    // Peek at the flag (nav detection effect will still consume it for scroll restoration).
    // Read from window.location.search (always the real browser URL) instead of
    // useSearchParams() which may return stale params from the cached RSC payload.
    const isBackNav = sessionStorage.getItem('is-popstate-navigation') === 'true';
    if (isBackNav) {
      const correctLimit = ITEMS_PER_PAGE[actualGridSize];

      // Try instant restore from snapshot (saved when user clicked a VN link).
      // Verify both the grid size limit and the URL match to avoid restoring stale data
      // (e.g., user visited browse with different filters between saving and restoring).
      const snapshotJson = sessionStorage.getItem('browse-snapshot');
      if (snapshotJson) {
        try {
          const snapshot = JSON.parse(snapshotJson);
          const urlMatches = snapshot.urlSearch === window.location.search;
          const limitMatches = snapshot.filters?.limit === correctLimit;
          if (urlMatches && limitMatches) {
            sessionStorage.removeItem('browse-snapshot');
            // Instant restore — no fetch, no loading flash.
            // Increment gridKey to force VNGrid remount: without this, VNGrid's
            // internal displayResults state still holds the stale initialData covers
            // (from the cached RSC payload) and only updates via a post-paint useEffect.
            // Since stt-restoring is removed via rAF (before useEffect), the stale covers
            // would flash briefly. Remounting VNGrid ensures displayResults initializes
            // from the correct snapshot data on first render.
            setGridKey(k => k + 1);
            setResults(snapshot.results);
            setTotal(snapshot.total);
            setTotalWithSpoilers(snapshot.totalWithSpoilers);
            setPages(snapshot.pages);
            setQueryTime(snapshot.queryTime);
            setDisplayedQueryTime(snapshot.displayedQueryTime);
            setFilters(snapshot.filters);
            pendingFiltersRef.current = snapshot.filters;
            setSelectedTags(snapshot.selectedTags);
            setSearchInput(snapshot.searchInput);
            setIsLoading(false);
            didRestoreSnapshotRef.current = true;
            return; // Skip refetch — data is already restored
          }
        } catch {
          // Parse failed — fall through to refetch
        }
        sessionStorage.removeItem('browse-snapshot');
      }

      // No valid snapshot — refetch with correct params.
      // Set flag so consumePendingScroll() runs after data loads (handles the case
      // where ScrollToTop's MutationObserver times out before the fetch completes).
      needsScrollRestoreRef.current = true;
      const urlParams = new URLSearchParams(window.location.search);
      const correctFilters = parseFiltersFromParams(urlParams, correctLimit);
      setFilters(correctFilters);
      pendingFiltersRef.current = correctFilters;
      setResults([]); // Clear stale cached results so VNGrid shows skeleton, not wrong covers
      setGridKey(k => k + 1); // Force VNGrid remount to clear its internal displayResults buffer
      fetchResults(correctFilters);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setGridSize = useCallback((size: GridSize) => {
    setGridSizeState(size);
    // Persist to cookie (server reads it for SSR) and localStorage (fallback)
    try {
      document.cookie = `browse-grid-size=${size};path=/;max-age=31536000;SameSite=Lax`;
      localStorage.setItem('browse-grid-size', size);
    } catch {}
  }, []);
  const [mobileFiltersExpanded, setMobileFiltersExpanded] = useState(false);

  // Ref for delayed loading overlay timer
  const overlayDelayRef = useRef<NodeJS.Timeout | null>(null);
  // Ref for aborting in-flight requests
  const abortControllerRef = useRef<AbortController | null>(null);
  // Ref for debouncing filter changes
  const filterDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const FILTER_DEBOUNCE_MS = 300; // Debounce rapid filter changes (300ms for multi-select filters)
  // Ref for prefetch cache (adjacent pages)
  const prefetchCacheRef = useRef<Map<string, BrowseResponse>>(new Map());
  const prefetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  // Ref to track forward navigation for defensive scroll-to-top after content renders
  const isForwardNavRef = useRef(false);
  // Gate ref: prevents Strict Mode double-invocation from re-processing nav detection
  // (second invocation would find the sessionStorage flag consumed and wrongly scroll to 0)
  const didDetectNavRef = useRef(false);
  // Ref for results section - used for pagination scroll target
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  // Ref: true when back-nav triggered a refetch (no valid snapshot) — signals
  // that we need to call consumePendingScroll() after data loads, in case
  // ScrollToTop's MutationObserver timed out before the fetch completed.
  const needsScrollRestoreRef = useRef(false);
  // Ref tracking latest pending filters for debounced fetches (avoids stale closures)
  const pendingFiltersRef = useRef<BrowseFilters>(initialFilters);
  // Guard ref: stores the query string of the last URL we set internally.
  // When searchParams changes, if it matches this value, we know the change was
  // self-initiated and skip sync effects. This prevents cascading re-renders
  // (replaceState → useSearchParams update → sync effect → unnecessary state/fetch work)
  // that cause brief content flashes on Firefox under load.
  const lastInternalQueryRef = useRef<string | null>(null);
  // Snapshot ref: tracks current browse state for instant back-navigation restore.
  // Updated via useEffect whenever results change. Read in the click handler (which
  // has [] deps) via ref access to always get the latest state at click time.
  const browseSnapshotRef = useRef<{
    results: VNSearchResult[];
    total: number;
    totalWithSpoilers: number | null;
    pages: number;
    queryTime: number | undefined;
    displayedQueryTime: number | undefined;
    filters: BrowseFilters;
    selectedTags: SelectedTag[];
    searchInput: string;
  } | null>(null);

  // Delayed loading overlay — only show for non-pagination loads after 200ms
  useEffect(() => {
    if (isLoading && !isPaginatingOnly) {
      overlayDelayRef.current = setTimeout(() => {
        setShowLoadingOverlay(true);
      }, 200);
    } else {
      if (overlayDelayRef.current) {
        clearTimeout(overlayDelayRef.current);
        overlayDelayRef.current = null;
      }
      setShowLoadingOverlay(false);
    }
    return () => {
      if (overlayDelayRef.current) {
        clearTimeout(overlayDelayRef.current);
      }
    };
  }, [isLoading, isPaginatingOnly]);

  // Cleanup debounce, prefetch timeouts, and in-flight prefetch requests on unmount
  useEffect(() => {
    return () => {
      if (filterDebounceRef.current) {
        clearTimeout(filterDebounceRef.current);
      }
      if (prefetchTimeoutRef.current) {
        clearTimeout(prefetchTimeoutRef.current);
      }
      if (prefetchAbortRef.current) {
        prefetchAbortRef.current.abort();
      }
      if (overlayDelayRef.current) {
        clearTimeout(overlayDelayRef.current);
      }
    };
  }, []);

  // Sync searchInput with URL when navigating (e.g., clicking Browse link resets query).
  // Skip when the URL change was self-initiated — we already have the correct state.
  useEffect(() => {
    if (lastInternalQueryRef.current !== null) return;
    const urlQuery = searchParams.get('q') || '';
    if (searchInput !== urlQuery) {
      setSearchInput(urlQuery);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect navigation type for forward-nav scroll safety.
  // ScrollToTop handles all back-nav scroll restoration (via MutationObserver),
  // so BrowsePageClient only needs to handle the forward-nav edge case.
  //
  // Gate with didDetectNavRef: React Strict Mode double-invokes [] effects on mount.
  // Without the gate, the 2nd invocation finds 'is-popstate-navigation' consumed,
  // misidentifies back-nav as forward-nav, and scrolls to 0.
  useEffect(() => {
    if (didDetectNavRef.current) return;
    didDetectNavRef.current = true;

    const isBackNav = sessionStorage.getItem('is-popstate-navigation') === 'true';
    sessionStorage.removeItem('is-popstate-navigation');

    if (isBackNav) {
      // Back/forward navigation — ScrollToTop handles scroll restoration.
      // Clean up any stale browse-scroll key (no longer used).
      sessionStorage.removeItem('browse-scroll');
    } else {
      // Forward navigation - clear any stale scroll position and ensure page is at top.
      // This is defensive: ScrollToTop normally handles this, but it only watches pathname
      // changes. Same-pathname navigations (e.g. /browse/?developer=p42 → /browse/ via
      // nav link) don't trigger ScrollToTop's pathname effect, leaving the page mid-scroll.
      sessionStorage.removeItem('browse-scroll');
      window.scrollTo(0, 0);
      isForwardNavRef.current = true;
    }
  }, []);

  // Keep browse snapshot ref current — captures latest state for the click handler.
  // Only updates when we have actual results (not during loading).
  useEffect(() => {
    if (!isLoading && results.length > 0) {
      browseSnapshotRef.current = {
        results, total, totalWithSpoilers, pages, queryTime, displayedQueryTime,
        filters, selectedTags, searchInput,
      };
    }
  }, [isLoading, results, total, totalWithSpoilers, pages, queryTime, displayedQueryTime, filters, selectedTags, searchInput]);

  // Save browse state snapshot when clicking any link that navigates away from browse,
  // enabling instant back-navigation. Previously only saved for VN links — now covers
  // character, tag, staff, and all other outgoing links for a smoother back experience.
  // Scroll position is saved separately by ScrollToTop (generic, all pages).
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a[href]') as HTMLAnchorElement | null;
      if (!link) return;
      try {
        const url = new URL(link.href, window.location.origin);
        // Only save for internal links navigating away from browse
        if (url.origin === window.location.origin && url.pathname !== window.location.pathname) {
          if (browseSnapshotRef.current) {
            sessionStorage.setItem('browse-snapshot', JSON.stringify({
              ...browseSnapshotRef.current,
              urlSearch: window.location.search,
            }));
          }
        }
      } catch {
        // Invalid URL or sessionStorage full — back nav will fall back to refetching
      }
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  // Forward nav safety: re-assert scroll-to-top after content renders.
  // Handles mobile edge cases where momentum scrolling, Suspense transitions,
  // or browser viewport changes override the initial scrollTo(0, 0).
  // Back-nav scroll restoration is handled entirely by ScrollToTop (via MutationObserver).
  useEffect(() => {
    if (isForwardNavRef.current && !isLoading && results.length > 0) {
      isForwardNavRef.current = false;
      requestAnimationFrame(() => {
        if (window.scrollY !== 0) window.scrollTo(0, 0);
      });
    }
  }, [isLoading, results.length]);

  // Back-nav scroll restore: after refetch completes (no valid snapshot path),
  // call consumePendingScroll() to restore the saved position. This handles the
  // case where ScrollToTop's MutationObserver timed out before our fetch finished
  // (common on slow mobile networks).
  useEffect(() => {
    if (needsScrollRestoreRef.current && !isLoading && results.length > 0) {
      needsScrollRestoreRef.current = false;
      consumePendingScroll();
    }
  }, [isLoading, results.length]);

  // Only update displayed query time when filters change (not on pagination)
  // This prevents the "in X.XXXs" from flashing on every page change
  useEffect(() => {
    if (!isPaginatingOnly && queryTime !== undefined) {
      setDisplayedQueryTime(queryTime);
    }
  }, [queryTime, isPaginatingOnly]);

  // Resolve tag/trait IDs to names when only IDs are in URL (e.g., from chart links)
  // Uses batch API calls for better performance
  useEffect(() => {
    async function resolveTagsFromIds() {
      // Check if we have tag/trait/entity IDs in filters but no selectedTags
      const hasTagIds = initialFilters.tags || initialFilters.exclude_tags;
      const hasTraitIds = initialFilters.traits || initialFilters.exclude_traits;
      const hasEntityIds = initialFilters.staff || initialFilters.seiyuu || initialFilters.developer || initialFilters.publisher;
      const hasTagNames = initialTags.length > 0;

      if ((hasTagIds || hasTraitIds || hasEntityIds) && !hasTagNames) {
        const resolvedTags: SelectedTag[] = [];

        // Collect all tag IDs for batch resolution
        const includeTagIds = initialFilters.tags?.split(',').filter(id => id.trim()) || [];
        const excludeTagIds = initialFilters.exclude_tags?.split(',').filter(id => id.trim()) || [];
        const allTagIds = [...includeTagIds, ...excludeTagIds];

        // Collect all trait IDs for batch resolution
        const includeTraitIds = initialFilters.traits?.split(',').filter(id => id.trim()) || [];
        const excludeTraitIds = initialFilters.exclude_traits?.split(',').filter(id => id.trim()) || [];
        const allTraitIds = [...includeTraitIds, ...excludeTraitIds];

        // Batch fetch tags and traits in parallel
        let tagsMap: Map<string, { name: string }>;
        let traitsMap: Map<string, { name: string }>;
        try {
          [tagsMap, traitsMap] = await Promise.all([
            allTagIds.length > 0 ? vndbStatsApi.getTags(allTagIds) : Promise.resolve(new Map()),
            allTraitIds.length > 0 ? vndbStatsApi.getTraits(allTraitIds) : Promise.resolve(new Map()),
          ]);
        } catch {
          // If tag/trait resolution fails, fall back to using IDs as names
          tagsMap = new Map();
          traitsMap = new Map();
        }

        // Resolve include tags from batch result
        for (const tagId of includeTagIds) {
          const tag = tagsMap.get(tagId);
          if (tag) {
            resolvedTags.push({
              id: tagId,
              name: tag.name,
              mode: 'include',
              type: 'tag',
            });
          }
        }

        // Resolve exclude tags from batch result
        for (const tagId of excludeTagIds) {
          const tag = tagsMap.get(tagId);
          if (tag) {
            resolvedTags.push({
              id: tagId,
              name: tag.name,
              mode: 'exclude',
              type: 'tag',
            });
          }
        }

        // Resolve include traits from batch result
        for (const traitId of includeTraitIds) {
          const trait = traitsMap.get(traitId);
          if (trait) {
            resolvedTags.push({
              id: traitId,
              name: trait.name,
              mode: 'include',
              type: 'trait',
            });
          }
        }

        // Resolve exclude traits from batch result
        for (const traitId of excludeTraitIds) {
          const trait = traitsMap.get(traitId);
          if (trait) {
            resolvedTags.push({
              id: traitId,
              name: trait.name,
              mode: 'exclude',
              type: 'trait',
            });
          }
        }

        // Resolve entity IDs (staff, seiyuu, developer, publisher)
        // These don't have individual lookup endpoints, so use the ID as fallback name
        const entityParams: { param: string | undefined; type: FilterEntityType }[] = [
          { param: initialFilters.staff, type: 'staff' },
          { param: initialFilters.seiyuu, type: 'seiyuu' },
          { param: initialFilters.developer, type: 'developer' },
          { param: initialFilters.publisher, type: 'publisher' },
        ];
        for (const { param, type } of entityParams) {
          if (param) {
            const ids = param.split(',').filter(id => id.trim());
            for (const id of ids) {
              resolvedTags.push({
                id,
                name: id, // Fallback to ID as name
                mode: 'include',
                type,
              });
            }
          }
        }

        if (resolvedTags.length > 0) {
          setSelectedTags(resolvedTags);
        }
      }
    }

    resolveTagsFromIds();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update URL when filters change
  const updateURL = useCallback((newFilters: BrowseFilters, tags: SelectedTag[] = selectedTags) => {
    const params = new URLSearchParams();

    if (newFilters.q) params.set('q', newFilters.q);
    if (newFilters.first_char) params.set('first_char', newFilters.first_char);
    if (newFilters.tags) params.set('tags', newFilters.tags);
    if (newFilters.exclude_tags) params.set('exclude_tags', newFilters.exclude_tags);
    if (newFilters.traits) params.set('traits', newFilters.traits);
    if (newFilters.exclude_traits) params.set('exclude_traits', newFilters.exclude_traits);
    if (newFilters.tag_mode && newFilters.tag_mode !== 'and') params.set('tag_mode', newFilters.tag_mode);
    if (newFilters.include_children !== undefined) params.set('include_children', String(newFilters.include_children));
    if (newFilters.year_min) params.set('year_min', String(newFilters.year_min));
    if (newFilters.year_max) params.set('year_max', String(newFilters.year_max));
    if (newFilters.min_rating) params.set('min_rating', String(newFilters.min_rating));
    if (newFilters.max_rating) params.set('max_rating', String(newFilters.max_rating));
    if (newFilters.min_votecount) params.set('min_votecount', String(newFilters.min_votecount));
    if (newFilters.max_votecount) params.set('max_votecount', String(newFilters.max_votecount));
    // Multi-select filters: when there's an exclude but no include, explicitly set empty string
    // to signal "no include filter" (prevents default from being applied on reload)
    if (newFilters.length) params.set('length', newFilters.length);
    else if (newFilters.exclude_length) params.set('length', ''); // Explicit "no filter"
    if (newFilters.exclude_length) params.set('exclude_length', newFilters.exclude_length);

    if (newFilters.minage) params.set('minage', newFilters.minage);
    if (newFilters.exclude_minage) params.set('exclude_minage', newFilters.exclude_minage);

    if (newFilters.devstatus && newFilters.devstatus !== '-1') params.set('devstatus', newFilters.devstatus);
    if (newFilters.exclude_devstatus) params.set('exclude_devstatus', newFilters.exclude_devstatus);

    if (newFilters.olang) params.set('olang', newFilters.olang);
    else if (newFilters.exclude_olang) params.set('olang', ''); // Explicit "all languages"
    if (newFilters.exclude_olang) params.set('exclude_olang', newFilters.exclude_olang);

    if (newFilters.platform) params.set('platform', newFilters.platform);
    else if (newFilters.exclude_platform) params.set('platform', ''); // Explicit "all platforms"
    if (newFilters.exclude_platform) params.set('exclude_platform', newFilters.exclude_platform);
    if (newFilters.spoiler_level !== undefined && newFilters.spoiler_level > 0) params.set('spoiler_level', String(newFilters.spoiler_level));
    // Entity filters
    if (newFilters.staff) params.set('staff', newFilters.staff);
    if (newFilters.seiyuu) params.set('seiyuu', newFilters.seiyuu);
    if (newFilters.developer) params.set('developer', newFilters.developer);
    if (newFilters.publisher) params.set('publisher', newFilters.publisher);
    if (newFilters.producer) params.set('producer', newFilters.producer);
    if (newFilters.sort && newFilters.sort !== 'rating') params.set('sort', newFilters.sort);
    if (newFilters.sort_order && newFilters.sort_order !== 'desc') params.set('sort_order', newFilters.sort_order);
    if (newFilters.page && newFilters.page > 1) params.set('page', String(newFilters.page));

    // Store tag/trait names in URL for display (type:id:name format)
    const includeTags = tags.filter(t => t.mode === 'include');
    const excludeTags = tags.filter(t => t.mode === 'exclude');
    if (includeTags.length > 0) {
      params.set('tag_names', includeTags.map(t => `${t.type}:${t.id}:${t.name}`).join(','));
    }
    if (excludeTags.length > 0) {
      params.set('exclude_tag_names', excludeTags.map(t => `${t.type}:${t.id}:${t.name}`).join(','));
    }

    const queryString = params.toString();
    // Use replaceState directly instead of router.replace to avoid triggering a
    // Next.js soft navigation (RSC refetch). This prevents the browser tab title
    // from briefly flashing the URL while metadata is re-evaluated.
    // Next.js patches History API, so useSearchParams() still updates correctly.
    // Wrapped in startTransition so React treats the resulting useSearchParams()
    // update as non-urgent and keeps old content visible (no Suspense flash).
    lastInternalQueryRef.current = queryString;
    const url = `/browse/${queryString ? `?${queryString}` : ''}`;
    startTransition(() => {
      window.history.replaceState(window.history.state, '', url);
    });
  }, [selectedTags]);

  // Fetch results (with prefetch cache support)
  const fetchResults = useCallback(async (currentFilters: BrowseFilters) => {
    // Check prefetch cache first for instant navigation
    const cacheKey = JSON.stringify(currentFilters);
    const cachedResponse = prefetchCacheRef.current.get(cacheKey);
    if (cachedResponse) {
      prefetchCacheRef.current.delete(cacheKey);
      // Preload above-fold images — gives a head start before React renders.
      // If prefetchPage already loaded them, this is a no-op (browser cache hit).
      const imgWidth = GRID_IMAGE_WIDTHS[gridSize];
      cachedResponse.results.slice(0, 8).forEach(vn => {
        if (vn.image_url) {
          const vnId = vn.id.startsWith('v') ? vn.id : `v${vn.id}`;
          const url = getProxiedImageUrl(vn.image_url, { width: imgWidth, vnId });
          if (url) { const img = new Image(); img.src = url; }
        }
      });
      // Wrap in startTransition so these 7 setState calls don't batch synchronously
      // with handlePageChange's setState calls. Without this, the entire data update
      // renders synchronously in the click handler (~10ms), adding to the synchronous
      // block that causes Firefox WebRender to drop text tiles.
      startTransition(() => {
        setResults(cachedResponse.results);
        setTotal(cachedResponse.total);
        setTotalWithSpoilers(cachedResponse.total_with_spoilers ?? null);
        setPages(cachedResponse.pages);
        setQueryTime(cachedResponse.query_time);
        setIsLoading(false);
        setIsPaginatingOnly(false);
      });
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    setFetchError(null);
    try {
      const response: BrowseResponse = await vndbStatsApi.browseVNs(currentFilters, abortController.signal);
      // Only update state if this request wasn't aborted
      if (!abortController.signal.aborted) {
        setResults(response.results);
        setTotal(response.total);
        setTotalWithSpoilers(response.total_with_spoilers ?? null);
        setPages(response.pages);
        setQueryTime(response.query_time);
        // Scroll restoration is handled by the dedicated effect that waits for content
      }
    } catch (error) {
      // Ignore abort errors - they're expected when cancelling requests
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      setFetchError('Failed to connect to the search service. Please try again.');
      setResults([]);
      setTotal(0);
      setTotalWithSpoilers(null);
      setPages(0);
    } finally {
      // Only set loading false if this request wasn't aborted
      if (!abortController.signal.aborted) {
        setIsLoading(false);
        setIsPaginatingOnly(false); // Reset after fetch completes
      }
    }
  }, []);

  // Prefetch a page for faster navigation
  const prefetchPage = useCallback(async (page: number) => {
    const prefetchFilters = { ...filters, page };
    const cacheKey = JSON.stringify(prefetchFilters);

    // Skip if already cached
    if (prefetchCacheRef.current.has(cacheKey)) return;

    // Cancel previous prefetch and create new abort controller
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort();
    }
    const abortController = new AbortController();
    prefetchAbortRef.current = abortController;

    try {
      const response = await vndbStatsApi.browseVNs(prefetchFilters, abortController.signal);
      // Only cache if not aborted
      if (!abortController.signal.aborted) {
        prefetchCacheRef.current.set(cacheKey, response);

        // Preload above-fold images so they're in browser cache when user navigates.
        // On mobile (no hover), adjacent pages are auto-prefetched after load,
        // giving images a head start before the user taps next/prev.
        const imgWidth = GRID_IMAGE_WIDTHS[gridSize];
        response.results.slice(0, 8).forEach(vn => {
          if (vn.image_url) {
            const vnId = vn.id.startsWith('v') ? vn.id : `v${vn.id}`;
            const url = getProxiedImageUrl(vn.image_url, { width: imgWidth, vnId });
            if (url) { const img = new Image(); img.src = url; }
          }
        });

        // Limit cache size to prevent memory bloat
        if (prefetchCacheRef.current.size > 10) {
          const firstKey = prefetchCacheRef.current.keys().next().value;
          if (firstKey) prefetchCacheRef.current.delete(firstKey);
        }
      }
    } catch {
      // Ignore prefetch errors - they're non-critical
    }
  }, [filters]);

  // Prefetch adjacent pages after successful load
  useEffect(() => {
    if (!isLoading && results.length > 0 && filters.page && pages > 1) {
      // Clear any pending prefetch
      if (prefetchTimeoutRef.current) {
        clearTimeout(prefetchTimeoutRef.current);
      }

      // Prefetch after a short delay to avoid competing with main request
      prefetchTimeoutRef.current = setTimeout(() => {
        const currentPage = filters.page || 1;
        if (currentPage < pages) prefetchPage(currentPage + 1);
        if (currentPage > 1) prefetchPage(currentPage - 1);
        if (currentPage + 1 < pages) prefetchPage(currentPage + 2);
      }, 200);
    }
  }, [isLoading, results.length, filters.page, pages, prefetchPage]);

  // Fetch total database count once (no filters - raw total) with localStorage caching
  useEffect(() => {
    const TOTAL_CACHE_KEY = 'vndb_total_count';
    const TOTAL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

    async function fetchDatabaseTotal() {
      // Check localStorage cache first
      try {
        const cached = localStorage.getItem(TOTAL_CACHE_KEY);
        if (cached) {
          const { value, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < TOTAL_CACHE_TTL) {
            setDatabaseTotal(value);
            return;
          }
        }
      } catch {
        // localStorage parse error - continue to fetch
      }

      // Fetch from API
      try {
        const response = await vndbStatsApi.browseVNs({
          devstatus: '-1', // All statuses (finished, in dev, cancelled)
          limit: 1,
        });
        setDatabaseTotal(response.total);
        // Cache the result
        try {
          localStorage.setItem(TOTAL_CACHE_KEY, JSON.stringify({
            value: response.total,
            timestamp: Date.now(),
          }));
        } catch {
          // localStorage write failed - ignore
        }
      } catch {
        // Database total fetch failed - display defaults
      }
    }
    fetchDatabaseTotal();
  }, []);

  // Fetch totals for entity types on demand (when tab is active or visited)
  // Tags/Traits are fast queries; Staff/Seiyuu/Producers are slow and also prefetch first page
  const fetchedEntityTotals = useRef(new Set<string>());

  useEffect(() => {
    const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

    async function fetchWithCache(
      cacheKey: string,
      setter: (val: number) => void,
      fetcher: () => Promise<{ total: number }>
    ) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { value, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_TTL) {
            setter(value);
            return;
          }
        }
      } catch {
        // Continue to fetch
      }
      try {
        const response = await fetcher();
        setter(response.total);
        localStorage.setItem(cacheKey, JSON.stringify({ value: response.total, timestamp: Date.now() }));
      } catch {
        // Failed to fetch
      }
    }

    // Tags/Traits: lightweight total-only fetch (only when their tab is active)
    if (activeTab === 'tags' && !fetchedEntityTotals.current.has('tags')) {
      fetchedEntityTotals.current.add('tags');
      fetchWithCache('vndb_tags_total_count', setTagsTotal, () => vndbStatsApi.browseTags({ limit: 1 }));
    }
    if (activeTab === 'traits' && !fetchedEntityTotals.current.has('traits')) {
      fetchedEntityTotals.current.add('traits');
      fetchWithCache('vndb_traits_total_count', setTraitsTotal, () => vndbStatsApi.browseTraits({ limit: 1 }));
    }

    // Staff/Seiyuu/Producers: prefetch first page (slow queries - cache in SWR)
    // These match the default params in each tab component
    const defaultParams = { sort: 'vn_count' as const, sort_order: 'desc' as const, page: 1, limit: 50, lang: 'ja' };

    if (activeTab === 'staff' && !fetchedEntityTotals.current.has('staff')) {
      fetchedEntityTotals.current.add('staff');
      vndbStatsApi.browseStaff(defaultParams).then(data => {
        setStaffTotal(data.total);
        localStorage.setItem('vndb_staff_total_count', JSON.stringify({ value: data.total, timestamp: Date.now() }));
        // Pre-populate SWR cache so tab loads instantly
        mutate(['browseStaff', JSON.stringify(defaultParams)], data, false);
      }).catch(() => {});
    }

    if (activeTab === 'seiyuu' && !fetchedEntityTotals.current.has('seiyuu')) {
      fetchedEntityTotals.current.add('seiyuu');
      vndbStatsApi.browseSeiyuu(defaultParams).then(data => {
        setSeiyuuTotal(data.total);
        localStorage.setItem('vndb_seiyuu_total_count', JSON.stringify({ value: data.total, timestamp: Date.now() }));
        mutate(['browseSeiyuu', JSON.stringify(defaultParams)], data, false);
      }).catch(() => {});
    }

    if (activeTab === 'producers' && !fetchedEntityTotals.current.has('producers')) {
      fetchedEntityTotals.current.add('producers');
      vndbStatsApi.browseProducers(defaultParams).then(data => {
        setProducersTotal(data.total);
        localStorage.setItem('vndb_producers_total_count', JSON.stringify({ value: data.total, timestamp: Date.now() }));
        mutate(['browseProducers', JSON.stringify(defaultParams)], data, false);
      }).catch(() => {});
    }
  }, [activeTab]);

  // Sync state when URL params change (e.g., clicking "Browse" nav link clears params,
  // or external navigation to /browse/?q=xxx from search bar).
  // Skip when the URL change was self-initiated — we already have the correct state.
  useEffect(() => {
    if (lastInternalQueryRef.current !== null) {
      const expectedQuery = lastInternalQueryRef.current;
      lastInternalQueryRef.current = null;
      // Only skip if URL matches our self-initiated change.
      // If URL is different (e.g., nav link cleared params), proceed with sync.
      if (searchParams.toString() === expectedQuery) {
        return;
      }
    }

    // Check if URL has been reset to no params (user clicked Browse link)
    const urlHasParams = searchParams.toString().length > 0;
    const currentFilters = pendingFiltersRef.current;
    const stateHasNonDefaultValues = currentFilters.q || currentFilters.first_char || currentFilters.tags ||
      currentFilters.exclude_tags || currentFilters.traits || currentFilters.exclude_traits ||
      (currentFilters.olang && currentFilters.olang !== 'ja') || currentFilters.year_min || currentFilters.year_max ||
      currentFilters.length || currentFilters.minage || currentFilters.platform ||
      currentFilters.staff || currentFilters.seiyuu || currentFilters.developer || currentFilters.publisher ||
      (currentFilters.devstatus && currentFilters.devstatus !== '-1') || selectedTags.length > 0 ||
      (currentFilters.page && currentFilters.page !== 1); // Also reset if not on page 1

    // If URL has no params but state has non-default values, reset to defaults
    if (!urlHasParams && stateHasNonDefaultValues) {
      const defaultFilters: BrowseFilters = {
        sort: 'rating',
        sort_order: 'desc',
        page: 1,
        limit: ITEMS_PER_PAGE[gridSize],
        devstatus: '-1',
        olang: 'ja',
        include_children: true,
        spoiler_level: 0,
        tag_mode: 'and',
      };
      setFilters(defaultFilters);
      pendingFiltersRef.current = defaultFilters;
      setSearchInput('');
      setSelectedTags([]);
      fetchResults(defaultFilters);
      return;
    }

    // Sync q param from URL if it changed externally (e.g., navigated from search bar)
    if (urlHasParams) {
      const urlQ = searchParams.get('q') || undefined;
      if (urlQ !== (currentFilters.q || undefined)) {
        const updated = { ...currentFilters, q: urlQ, page: 1 };
        setFilters(updated);
        pendingFiltersRef.current = updated;
        setSearchInput(urlQ || '');
        fetchResults(updated);
      }
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial fetch - skip if we have SSR data or restored from snapshot
  useEffect(() => {
    if (!initialData && !didRestoreSnapshotRef.current) {
      fetchResults(initialFilters);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when grid size changes (different items per page)
  // Preserve approximate scroll position by calculating equivalent page
  useEffect(() => {
    const newLimit = ITEMS_PER_PAGE[gridSize];
    if (filters.limit !== newLimit) {
      const currentPage = filters.page || 1;
      const currentLimit = filters.limit || ITEMS_PER_PAGE['small'];
      const firstItemIndex = (currentPage - 1) * currentLimit;
      const equivalentPage = Math.max(1, Math.floor(firstItemIndex / newLimit) + 1);
      const updated = { ...filters, limit: newLimit, page: equivalentPage };
      setFilters(updated);
      updateURL(updated, selectedTags);
      fetchResults(updated);
    }
  }, [gridSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle filter changes with debouncing to batch rapid multi-filter adjustments
  const handleFilterChange = useCallback((newFilters: Partial<BrowseFilters>) => {
    setSkipPreload(false); // Filter change — use preload buffer for smooth transition
    setIsPaginatingOnly(false); // This is a filter change, not pagination-only

    // Compute from ref (always current) to avoid stale closure
    const updated = { ...pendingFiltersRef.current, ...newFilters, page: 1 };
    pendingFiltersRef.current = updated;
    setFilters(updated);
    updateURL(updated, selectedTags);

    // Debounce the fetch to batch rapid filter changes
    if (filterDebounceRef.current) {
      clearTimeout(filterDebounceRef.current);
    }
    filterDebounceRef.current = setTimeout(() => {
      fetchResults(pendingFiltersRef.current);
    }, FILTER_DEBOUNCE_MS);
  }, [updateURL, fetchResults, selectedTags]);

  // Handle tag/trait/entity changes with debouncing
  const handleTagsChange = useCallback((newTags: SelectedTag[]) => {
    setSkipPreload(false); // Filter change — use preload buffer for smooth transition
    setIsPaginatingOnly(false); // This is a filter change, not pagination-only

    setSelectedTags(newTags);
    // Separate tags, traits, and entities
    const includeTags = newTags.filter(t => t.mode === 'include' && t.type === 'tag').map(t => t.id);
    const excludeTags = newTags.filter(t => t.mode === 'exclude' && t.type === 'tag').map(t => t.id);
    const includeTraits = newTags.filter(t => t.mode === 'include' && t.type === 'trait').map(t => t.id);
    const excludeTraits = newTags.filter(t => t.mode === 'exclude' && t.type === 'trait').map(t => t.id);
    // Entity filters (include-only for now)
    const staffIds = newTags.filter(t => t.type === 'staff' && t.mode === 'include').map(t => t.id);
    const seiyuuIds = newTags.filter(t => t.type === 'seiyuu' && t.mode === 'include').map(t => t.id);
    const devIds = newTags.filter(t => t.type === 'developer' && t.mode === 'include').map(t => t.id);
    const pubIds = newTags.filter(t => t.type === 'publisher' && t.mode === 'include').map(t => t.id);
    // Compute from ref (always current) to avoid stale closure
    const updated = {
      ...pendingFiltersRef.current,
      tags: includeTags.length > 0 ? includeTags.join(',') : undefined,
      exclude_tags: excludeTags.length > 0 ? excludeTags.join(',') : undefined,
      traits: includeTraits.length > 0 ? includeTraits.join(',') : undefined,
      exclude_traits: excludeTraits.length > 0 ? excludeTraits.join(',') : undefined,
      staff: staffIds.length > 0 ? staffIds.join(',') : undefined,
      seiyuu: seiyuuIds.length > 0 ? seiyuuIds.join(',') : undefined,
      developer: devIds.length > 0 ? devIds.join(',') : undefined,
      publisher: pubIds.length > 0 ? pubIds.join(',') : undefined,
      page: 1,
    };
    pendingFiltersRef.current = updated;
    setFilters(updated);
    updateURL(updated, newTags);

    // Debounce the fetch to batch rapid filter changes
    if (filterDebounceRef.current) {
      clearTimeout(filterDebounceRef.current);
    }
    filterDebounceRef.current = setTimeout(() => {
      fetchResults(pendingFiltersRef.current);
    }, FILTER_DEBOUNCE_MS);
  }, [updateURL, fetchResults]);

  // Handle search submit
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    handleFilterChange({ q: searchInput || undefined });
  };

  // Handle alphabet click
  const handleAlphabetClick = (char: string | null) => {
    handleFilterChange({ first_char: char || undefined });
  };

  // Handle page change - immediate fetch (no debounce)
  const handlePageChange = (page: number) => {
    setSkipPreload(true); // Skip preload buffer — show results immediately, per-card shimmer handles loading
    setIsPaginatingOnly(true); // Mark as pagination-only to avoid "Searching..." flash
    const updated = { ...filters, page };
    setFilters(updated);
    updateURL(updated);

    // Clear any pending debounce - pagination should be immediate
    if (filterDebounceRef.current) {
      clearTimeout(filterDebounceRef.current);
    }
    fetchResults(updated);
  };

  // Prefetch a page on hover — triggers API fetch so data is cached when clicked
  const handlePrefetchPage = useCallback((page: number) => {
    if (page >= 1 && page <= pages) {
      prefetchPage(page);
    }
  }, [pages, prefetchPage]);

  // Clear all filters (reset to defaults: Japanese VNs, all dev status, include child tags)
  const handleClearFilters = () => {
    setSkipPreload(false); // Filter change — use preload buffer
    setSearchInput('');
    setSelectedTags([]);
    const cleared: BrowseFilters = {
      sort: 'rating',
      sort_order: 'desc',
      page: 1,
      limit: ITEMS_PER_PAGE[gridSize],
      devstatus: '-1', // All status (not just finished)
      olang: 'ja', // Default to Japanese
      include_children: true, // Default to include child tags
      spoiler_level: 0, // Default to hide spoilers
      // Clear all exclude fields
      exclude_length: undefined,
      exclude_minage: undefined,
      exclude_devstatus: undefined,
      exclude_olang: undefined,
      exclude_platform: undefined,
      // Clear entity filters
      staff: undefined,
      seiyuu: undefined,
      developer: undefined,
      publisher: undefined,
    };
    setFilters(cleared);
    updateURL(cleared, []);
    fetchResults(cleared);
  };

  // Remove a single filter value (for ActiveFilterChips)
  const handleRemoveFilter = useCallback((filterKey: keyof BrowseFilters, value?: string) => {
    // Read current filters from ref to avoid stale closure
    const currentFilters = pendingFiltersRef.current;
    const currentValue = currentFilters[filterKey];

    if (value && typeof currentValue === 'string') {
      // Remove a specific value from comma-separated list
      const values = currentValue.split(',').map(v => v.trim()).filter(v => v !== value);
      const newValue = values.length > 0 ? values.join(',') : undefined;

      // Special handling for olang: when clearing, use undefined to trigger default
      if (filterKey === 'olang' && !newValue) {
        handleFilterChange({ [filterKey]: undefined });
      } else if (filterKey === 'devstatus' && !newValue) {
        handleFilterChange({ [filterKey]: '-1' }); // Reset to all
      } else {
        handleFilterChange({ [filterKey]: newValue });
      }
    } else {
      // Clear the entire filter (with paired range handling)
      if (filterKey === 'include_children') {
        handleFilterChange({ include_children: true }); // Reset to default
      } else if (filterKey === 'spoiler_level') {
        handleFilterChange({ spoiler_level: 0 }); // Reset to default
      } else if (filterKey === 'year_min' || filterKey === 'year_max') {
        handleFilterChange({ year_min: undefined, year_max: undefined }); // Clear both ends of range
      } else if (filterKey === 'min_rating' || filterKey === 'max_rating') {
        handleFilterChange({ min_rating: undefined, max_rating: undefined }); // Clear both ends of range
      } else if (filterKey === 'min_votecount' || filterKey === 'max_votecount') {
        handleFilterChange({ min_votecount: undefined, max_votecount: undefined }); // Clear both ends of range
      } else {
        handleFilterChange({ [filterKey]: undefined });
      }
    }
  }, [handleFilterChange]);

  // Remove a single tag/trait/entity (for ActiveFilterChips)
  const handleRemoveTag = useCallback((tagId: string, tagType: FilterEntityType) => {
    const newTags = selectedTags.filter(t => !(t.id === tagId && t.type === tagType));
    handleTagsChange(newTags);
  }, [selectedTags, handleTagsChange]);

  // Check if any filters are active (defaults: olang='ja', include_children=true, devstatus='-1')
  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.q ||
      filters.first_char ||
      filters.tags ||
      filters.exclude_tags ||
      filters.traits ||
      filters.exclude_traits ||
      (filters.include_children === false) || // Only count if turned OFF (non-default)
      filters.year_min ||
      filters.year_max ||
      filters.min_rating ||
      filters.max_rating ||
      filters.min_votecount ||
      filters.max_votecount ||
      filters.length ||
      filters.exclude_length ||
      filters.minage ||
      filters.exclude_minage ||
      (filters.devstatus && filters.devstatus !== '-1') || // Not default
      filters.exclude_devstatus ||
      (filters.olang && filters.olang !== 'ja') || // Only count if not default
      filters.exclude_olang ||
      filters.platform ||
      filters.exclude_platform ||
      filters.staff ||
      filters.seiyuu ||
      filters.developer ||
      filters.publisher ||
      (filters.spoiler_level !== undefined && filters.spoiler_level > 0) || // Not default (showing spoilers)
      selectedTags.length > 0
    );
  }, [filters, selectedTags]);

  // Count active filters for mobile badge
  const activeFilterCount = useMemo(() => {
    let count = 0;

    // Text/alphabet filters
    if (filters.q) count++;
    if (filters.first_char) count++;

    // Multi-value filters (count each selected value)
    if (filters.olang && filters.olang !== 'ja') {
      count += filters.olang.split(',').length;
    }
    if (filters.exclude_olang) count += filters.exclude_olang.split(',').length;
    if (filters.platform) count += filters.platform.split(',').length;
    if (filters.exclude_platform) count += filters.exclude_platform.split(',').length;
    if (filters.length) count += filters.length.split(',').length;
    if (filters.exclude_length) count += filters.exclude_length.split(',').length;
    if (filters.minage) count += filters.minage.split(',').length;
    if (filters.exclude_minage) count += filters.exclude_minage.split(',').length;
    if (filters.devstatus && filters.devstatus !== '-1') {
      count += filters.devstatus.split(',').length;
    }
    if (filters.exclude_devstatus) count += filters.exclude_devstatus.split(',').length;

    // Range filters (count as 1 each if set)
    if (filters.year_min || filters.year_max) count++;
    if (filters.min_rating || filters.max_rating) count++;
    if (filters.min_votecount || filters.max_votecount) count++;

    // Tags/traits/entities
    count += selectedTags.length;

    // Special options (only count non-defaults)
    if (filters.include_children === false) count++;
    if (filters.spoiler_level !== undefined && filters.spoiler_level > 0) count++;

    return count;
  }, [filters, selectedTags]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-[1400px] mx-auto px-4 pt-6 pb-8">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {TAB_TITLES[activeTab]}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {activeTab === 'novels' && `Search and filter the database of ${databaseTotal !== null ? databaseTotal.toLocaleString() : '...'} visual novels`}
            {activeTab === 'tags' && `Browse the database of ${tagsTotal !== null ? tagsTotal.toLocaleString() : '...'} tags`}
            {activeTab === 'traits' && `Browse the database of ${traitsTotal !== null ? traitsTotal.toLocaleString() : '...'} traits`}
            {activeTab === 'staff' && `Browse the database of ${staffTotal !== null ? staffTotal.toLocaleString() : '...'} staff members`}
            {activeTab === 'seiyuu' && `Browse the database of ${seiyuuTotal !== null ? seiyuuTotal.toLocaleString() : '...'} voice actors`}
            {activeTab === 'producers' && `Browse the database of ${producersTotal !== null ? producersTotal.toLocaleString() : '...'} producers`}
          </p>
        </div>

        {/* Tab Bar */}
        <BrowseTabs activeTab={activeTab} onTabChange={handleTabChange} onTabHover={handleTabHover} />

        {/* Entity Tab Content (non-VN tabs) - conditionally rendered to free memory */}
        {activeTab === 'tags' && <BrowseTagsTab isActive />}
        {activeTab === 'traits' && <BrowseTraitsTab isActive />}
        {activeTab === 'staff' && <BrowseStaffTab isActive />}
        {activeTab === 'seiyuu' && <BrowseSeiyuuTab isActive />}
        {activeTab === 'producers' && <BrowseProducerTab isActive />}

        {/* VNDB Attribution for entity tabs (non-VN) */}
        {activeTab !== 'novels' && <VNDBAttribution />}

        {/* VN Browse Content (novels tab) */}
        {activeTab === 'novels' && (<>
        {/* MOBILE: Collapsible Filter Panel */}
        <MobileFilterPanel
          isExpanded={mobileFiltersExpanded}
          onToggle={() => setMobileFiltersExpanded(!mobileFiltersExpanded)}
          activeFilterCount={activeFilterCount}
        >
          <CompactFilterBar filters={filters} onChange={handleFilterChange} />
          <InlineRangeSliders filters={filters} onChange={handleFilterChange} />
          <TagFilter
            selectedTags={selectedTags}
            onTagsChange={handleTagsChange}
            tagMode={(filters.tag_mode as 'and' | 'or') || 'and'}
            onModeChange={(mode) => handleFilterChange({ tag_mode: mode })}
          />
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.include_children ?? true}
                onChange={(e) => handleFilterChange({ include_children: e.target.checked })}
                className="w-4 h-4 text-primary-600 bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded-sm focus:ring-primary-500"
              />
              <span className="text-xs text-gray-600 dark:text-gray-400">Include child tags</span>
            </label>
            <div className="flex items-center gap-2">
              {(filters.spoiler_level ?? 0) === 0 ? (
                <EyeOff className="w-4 h-4 text-gray-400" />
              ) : (
                <Eye className="w-4 h-4 text-amber-500" />
              )}
              <SimpleSelect
                options={[
                  { value: '0', label: 'Hide Spoilers' },
                  { value: '1', label: 'Minor Spoilers' },
                  { value: '2', label: 'All Spoilers' },
                ]}
                value={String(filters.spoiler_level ?? 0)}
                onChange={(v) => handleFilterChange({ spoiler_level: Number(v) })}
                compact
              />
            </div>
          </div>
          <AlphabetFilter
            activeChar={filters.first_char || null}
            onSelect={handleAlphabetClick}
          />
        </MobileFilterPanel>

        {/* TWO-COLUMN LAYOUT */}
        <div className="lg:flex lg:gap-6">
          {/* LEFT SIDEBAR - Desktop only */}
          <SidebarFilters
            filters={filters}
            onChange={handleFilterChange}
            selectedTags={selectedTags}
            onTagsChange={handleTagsChange}
            activeChar={filters.first_char || null}
            onAlphabetClick={handleAlphabetClick}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={handleClearFilters}
          />

          {/* RIGHT CONTENT */}
          <div className="flex-1 min-w-0">
            {/* Search Bar */}
            <form onSubmit={handleSearch} className="mb-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search by title..."
                  aria-label="Search visual novels by title"
                  className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>
            </form>

            {/* Active Filter Chips (dismissible pills showing applied filters) */}
            <ActiveFilterChips
              filters={filters}
              selectedTags={selectedTags}
              onRemoveFilter={handleRemoveFilter}
              onRemoveTag={handleRemoveTag}
              onClearAll={handleClearFilters}
            />

            {/* Error Banner */}
            {fetchError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mt-6 mb-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-red-800 dark:text-red-200">{fetchError}</p>
                  </div>
                  <button
                    onClick={() => fetchResults(filters)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry
                  </button>
                </div>
              </div>
            )}

            {/* Results Header */}
            <div ref={resultsContainerRef} className="scroll-mt-20 flex flex-wrap items-center justify-between gap-4 mb-3 mt-3">
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {isLoading && !isPaginatingOnly ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Searching...
                    </span>
                  ) : (
                    <>
                      <span className="text-gray-700 dark:text-gray-200">
                        {(totalWithSpoilers ?? total).toLocaleString()}
                      </span>
                      {' '}results
                      {totalWithSpoilers !== null && totalWithSpoilers > total && (
                        <span className="text-amber-600 dark:text-amber-500">
                          {' '}({(totalWithSpoilers - total).toLocaleString()} hidden)
                        </span>
                      )}
                      {displayedQueryTime !== undefined && (
                        <span className="text-gray-400 dark:text-gray-500">
                          {' '}in {displayedQueryTime.toFixed(3)}s
                        </span>
                      )}
                    </>
                  )}
                </span>
                {hasActiveFilters && (
                  <button
                    onClick={handleClearFilters}
                    className="flex items-center gap-1 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 lg:hidden"
                  >
                    <X className="w-4 h-4" />
                    Clear filters
                  </button>
                )}
              </div>

              {/* Sort Options and View Toggle */}
              <div className="flex items-center gap-2 flex-wrap">
                <SimpleSelect
                  options={[
                    { value: 'rating', label: 'Rating' },
                    { value: 'released', label: 'Release Date' },
                    { value: 'votecount', label: 'Popularity' },
                    { value: 'title', label: 'Title' },
                  ]}
                  value={filters.sort || 'rating'}
                  onChange={(v) => handleFilterChange({ sort: v as BrowseFilters['sort'] })}
                />
                <button
                  onClick={() => handleFilterChange({
                    sort_order: filters.sort_order === 'desc' ? 'asc' : 'desc'
                  })}
                  className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  title={filters.sort_order === 'desc' ? 'Descending' : 'Ascending'}
                >
                  {filters.sort_order === 'desc' ? '↓' : '↑'}
                  <span className="hidden sm:inline ml-1">{filters.sort_order === 'desc' ? 'Desc' : 'Asc'}</span>
                </button>
                <RandomButton entityType="vn" />
                <ViewModeToggle size={gridSize} onChange={setGridSize} />
              </div>
            </div>

            {/* Pagination Top */}
            {pages > 1 && (
              <Pagination
                currentPage={filters.page || 1}
                totalPages={pages}
                onPageChange={handlePageChange}
                onPrefetchPage={handlePrefetchPage}
              />
            )}

            {/* Results Grid */}
            <div>
              <VNGrid
                key={gridKey}
                results={results}
                isLoading={isLoading}
                showOverlay={showLoadingOverlay}
                isPaginating={isPaginatingOnly}
                skipPreload={skipPreload}
                preference={preference}
                gridSize={gridSize}
              />
            </div>

            {/* Pagination Bottom - scrolls to results section on page change */}
            {pages > 1 && (
              <Pagination
                currentPage={filters.page || 1}
                totalPages={pages}
                onPageChange={(page) => {
                  handlePageChange(page);
                  resultsContainerRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' });
                }}
                onPrefetchPage={handlePrefetchPage}
              />
            )}

            {/* VNDB Attribution */}
            <VNDBAttribution />
          </div>
        </div>
        </>)}
      </div>
    </div>
  );
}
