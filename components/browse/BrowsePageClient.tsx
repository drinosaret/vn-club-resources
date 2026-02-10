'use client';

import { useState, useEffect, useCallback, useMemo, startTransition, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Search, Loader2, X, AlertCircle, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { mutate } from 'swr';
import { vndbStatsApi, VNSearchResult, BrowseFilters, BrowseResponse } from '@/lib/vndb-stats-api';
import { useTitlePreference } from '@/lib/title-preference';
import { VNGrid } from './VNGrid';
import { Pagination, PaginationSkeleton } from './Pagination';
import { TagFilter, SelectedTag, FilterEntityType } from './TagFilter';
import { ViewModeToggle, GridSize } from './ViewModeToggle';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { CompactFilterBar } from './CompactFilterBar';
import { ActiveFilterChips } from './ActiveFilterChips';
import { InlineRangeSliders } from './InlineRangeSliders';
import { MobileFilterPanel } from './MobileFilterPanel';
import { SidebarFilters } from './SidebarFilters';
import { AlphabetFilter } from './AlphabetFilter';
import { BrowseTabs, BrowseTab } from './BrowseTabs';
import { SimpleSelect } from './SimpleSelect';

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
      <div className="w-24 h-5 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
      <div className="flex gap-2">
        <div className="w-28 h-8 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
        <div className="w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
      </div>
    </div>
    <PaginationSkeleton />
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {[...Array(10)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
          <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
          <div className="w-16 h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
          <div className="w-20 h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
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
}

export default function BrowsePageClient({ initialData, initialSearchParams }: BrowsePageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { preference } = useTitlePreference();

  // Tab state from URL
  const activeTab = (searchParams.get('tab') as BrowseTab) || 'novels';

  const handleTabChange = useCallback((tab: BrowseTab) => {
    const params = new URLSearchParams();
    if (tab !== 'novels') {
      params.set('tab', tab);
    }
    router.push(`/browse${params.toString() ? `?${params.toString()}` : ''}`);
  }, [router]);

  const handleTabHover = useCallback((tab: BrowseTab) => {
    TAB_PRELOADERS[tab]?.();
  }, []);

  // Parse initial state from URL (default: Japanese VNs only)
  const initialFilters = useMemo((): BrowseFilters => ({
    q: searchParams.get('q') || undefined,
    first_char: searchParams.get('first_char') || undefined,
    tags: searchParams.get('tags') || undefined,
    exclude_tags: searchParams.get('exclude_tags') || undefined,
    traits: searchParams.get('traits') || undefined,
    exclude_traits: searchParams.get('exclude_traits') || undefined,
    tag_mode: (searchParams.get('tag_mode') as 'and' | 'or') || 'and',
    include_children: searchParams.has('include_children') ? searchParams.get('include_children') === 'true' : true, // Default to true
    year_min: searchParams.get('year_min') ? Number(searchParams.get('year_min')) : undefined,
    year_max: searchParams.get('year_max') ? Number(searchParams.get('year_max')) : undefined,
    min_rating: searchParams.get('min_rating') ? Number(searchParams.get('min_rating')) : undefined,
    max_rating: searchParams.get('max_rating') ? Number(searchParams.get('max_rating')) : undefined,
    // Multi-select filters (comma-separated)
    // Empty string in URL means "no filter" (user explicitly cleared it)
    // Absent param means "use default" (for olang, defaults to 'ja')
    length: searchParams.get('length') || undefined,
    exclude_length: searchParams.get('exclude_length') || undefined,
    minage: searchParams.get('minage') || undefined,
    exclude_minage: searchParams.get('exclude_minage') || undefined,
    devstatus: searchParams.get('devstatus') || '-1', // Default: all status
    exclude_devstatus: searchParams.get('exclude_devstatus') || undefined,
    // olang: empty string = all languages, absent = default to Japanese
    olang: searchParams.has('olang') ? (searchParams.get('olang') || undefined) : 'ja',
    exclude_olang: searchParams.get('exclude_olang') || undefined,
    platform: searchParams.get('platform') || undefined,
    exclude_platform: searchParams.get('exclude_platform') || undefined,
    spoiler_level: searchParams.get('spoiler_level') ? Number(searchParams.get('spoiler_level')) : 0, // Default: hide spoilers
    // Entity filters
    staff: searchParams.get('staff') || undefined,
    seiyuu: searchParams.get('seiyuu') || undefined,
    developer: searchParams.get('developer') || undefined,
    publisher: searchParams.get('publisher') || undefined,
    producer: searchParams.get('producer') || undefined,
    sort: (searchParams.get('sort') as BrowseFilters['sort']) || 'rating',
    sort_order: (searchParams.get('sort_order') as 'asc' | 'desc') || 'desc',
    page: searchParams.get('page') ? Number(searchParams.get('page')) : 1,
    limit: ITEMS_PER_PAGE['medium'], // Default grid size
  }), [searchParams]);

  // Parse tags from URL
  const initialTags = useMemo(() => {
    const includeTags = parseTagsFromUrl(searchParams.get('tag_names'), 'include');
    const excludeTags = parseTagsFromUrl(searchParams.get('exclude_tag_names'), 'exclude');
    return [...includeTags, ...excludeTags];
  }, [searchParams]);

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
  const [gridSize, setGridSizeState] = useState<GridSize>('medium');
  const setGridSize = useCallback((size: GridSize) => {
    setGridSizeState(size);
    try { localStorage.setItem('browse-grid-size', size); } catch {}
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
  // Ref to track if current load is from back navigation (for scroll restoration)
  const isBackNavigationRef = useRef(false);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  // Ref to track forward navigation for defensive scroll-to-top after content renders
  const isForwardNavRef = useRef(false);
  // Ref for results section - used for pagination scroll target
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  // Ref tracking latest pending filters for debounced fetches (avoids stale closures)
  const pendingFiltersRef = useRef<BrowseFilters>(initialFilters);

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

  // Sync searchInput with URL when navigating (e.g., clicking Browse link resets query)
  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';
    if (searchInput !== urlQuery) {
      setSearchInput(urlQuery);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track back navigation for scroll restoration
  // ScrollToTop sets 'is-popstate-navigation' flag when it detects back/forward nav
  // (via absence of forward-nav link click flag). ScrollToTop's effects run before
  // this component's mount effects due to sibling render order in the layout.
  useEffect(() => {
    const isBackNav = sessionStorage.getItem('is-popstate-navigation') === 'true';
    sessionStorage.removeItem('is-popstate-navigation');

    if (isBackNav) {
      // Back/forward navigation - check for saved scroll
      const savedScroll = sessionStorage.getItem('browse-scroll');
      if (savedScroll) {
        pendingScrollRestoreRef.current = parseInt(savedScroll, 10);
        isBackNavigationRef.current = true;
        sessionStorage.removeItem('browse-scroll');
      }
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

  // Save scroll position when clicking VN links
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const vnLink = target.closest('a[href^="/vn/"]');
      if (vnLink) {
        sessionStorage.setItem('browse-scroll', String(window.scrollY));
      }
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  // Scroll restoration effect - waits for content AND sufficient DOM height before restoring
  // This is key: we can't restore scroll during skeleton loading phase because
  // the DOM height is wrong. We must wait for !isLoading && results.length > 0
  // AND for the page to be tall enough to scroll to the target position
  useEffect(() => {
    if (pendingScrollRestoreRef.current !== null && !isLoading && results.length > 0) {
      const targetScroll = pendingScrollRestoreRef.current;
      pendingScrollRestoreRef.current = null;
      isBackNavigationRef.current = false;

      const attemptScroll = () => {
        const canScroll = document.body.scrollHeight >= targetScroll + window.innerHeight;
        if (canScroll || targetScroll <= 0) {
          window.scrollTo(0, targetScroll);
          return true;
        }
        return false;
      };

      // Try immediately in next frame
      requestAnimationFrame(() => {
        if (attemptScroll()) return;

        // If page isn't tall enough yet (images loading), watch for size changes
        let timeoutId: NodeJS.Timeout;
        const observer = new ResizeObserver(() => {
          if (attemptScroll()) {
            observer.disconnect();
            clearTimeout(timeoutId);
          }
        });

        observer.observe(document.body);

        // Fallback: scroll to best available position after 1 second
        timeoutId = setTimeout(() => {
          observer.disconnect();
          const maxAvailable = Math.max(0, document.body.scrollHeight - window.innerHeight);
          window.scrollTo(0, Math.min(targetScroll, maxAvailable));
        }, 1000);
      });
    } else if (isForwardNavRef.current && !isLoading && results.length > 0) {
      // Forward nav safety: re-assert scroll-to-top after content renders.
      // Handles mobile edge cases where momentum scrolling, Suspense transitions,
      // or browser viewport changes override the initial scrollTo(0, 0).
      isForwardNavRef.current = false;
      requestAnimationFrame(() => {
        if (window.scrollY !== 0) window.scrollTo(0, 0);
      });
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
    // Use startTransition and replace to prevent UI flickering during URL updates
    startTransition(() => {
      router.replace(queryString ? `/browse?${queryString}` : '/browse', { scroll: false });
    });
  }, [router, selectedTags]);

  // Fetch results (with prefetch cache support)
  const fetchResults = useCallback(async (currentFilters: BrowseFilters) => {
    // Check prefetch cache first for instant navigation
    const cacheKey = JSON.stringify(currentFilters);
    const cachedResponse = prefetchCacheRef.current.get(cacheKey);
    if (cachedResponse) {
      setResults(cachedResponse.results);
      setTotal(cachedResponse.total);
      setTotalWithSpoilers(cachedResponse.total_with_spoilers ?? null);
      setPages(cachedResponse.pages);
      setQueryTime(cachedResponse.query_time);
      setIsLoading(false);
      setIsPaginatingOnly(false); // Reset after fetch completes
      prefetchCacheRef.current.delete(cacheKey); // Remove after use
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

  // Sync state when URL params change (e.g., clicking "Browse" nav link clears params)
  useEffect(() => {
    // Check if URL has been reset to no params (user clicked Browse link)
    const urlHasParams = searchParams.toString().length > 0;
    const stateHasNonDefaultValues = filters.q || filters.first_char || filters.tags ||
      filters.exclude_tags || filters.traits || filters.exclude_traits ||
      (filters.olang && filters.olang !== 'ja') || filters.year_min || filters.year_max ||
      filters.length || filters.minage || filters.platform ||
      filters.staff || filters.seiyuu || filters.developer || filters.publisher ||
      (filters.devstatus && filters.devstatus !== '-1') || selectedTags.length > 0 ||
      (filters.page && filters.page !== 1); // Also reset if not on page 1

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
      setSearchInput('');
      setSelectedTags([]);
      fetchResults(defaultFilters);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial fetch - skip if we have SSR data
  useEffect(() => {
    if (!initialData) {
      fetchResults(initialFilters);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore persisted grid size from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('browse-grid-size') as GridSize | null;
      if (saved && ['small', 'medium', 'large'].includes(saved)) {
        setGridSizeState(saved);
      }
    } catch {}
  }, []);

  // Re-fetch when grid size changes (different items per page)
  // Preserve approximate scroll position by calculating equivalent page
  useEffect(() => {
    const newLimit = ITEMS_PER_PAGE[gridSize];
    if (filters.limit !== newLimit) {
      const currentPage = filters.page || 1;
      const currentLimit = filters.limit || ITEMS_PER_PAGE['medium'];
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
    pendingScrollRestoreRef.current = null; // Clear pending scroll restore on filter change
    // Use functional update to avoid stale closure when rapid changes occur
    setFilters(prev => {
      const updated = { ...prev, ...newFilters, page: 1 };
      pendingFiltersRef.current = updated;
      updateURL(updated, selectedTags);
      return updated;
    });

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
    pendingScrollRestoreRef.current = null; // Clear pending scroll restore on filter change
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
    // Use functional update to avoid stale closure
    setFilters(prev => {
      const updated = {
        ...prev,
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
      updateURL(updated, newTags);
      return updated;
    });

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
    setSkipPreload(true); // Skip image preload buffer — VNCover shimmers handle it
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
                className="w-4 h-4 text-primary-600 bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-primary-500"
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
            <form onSubmit={handleSearch} className="mb-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search by title..."
                    aria-label="Search visual novels by title"
                    className="w-full pl-10 pr-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <button
                  type="submit"
                  className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors"
                >
                  Search
                </button>
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
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-red-800 dark:text-red-200">{fetchError}</p>
                  </div>
                  <button
                    onClick={() => fetchResults(filters)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors flex-shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry
                  </button>
                </div>
              </div>
            )}

            {/* Results Header */}
            <div ref={resultsContainerRef} className="scroll-mt-20 flex flex-wrap items-center justify-between gap-4 mb-4 mt-4">
              <div className="flex items-center gap-4">
                <span className="text-gray-600 dark:text-gray-400">
                  {isLoading && !isPaginatingOnly ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Searching...
                    </span>
                  ) : (
                    <>
                      <span className="font-semibold text-gray-900 dark:text-white">
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
                  <span className="hidden sm:inline text-xs ml-1">{filters.sort_order === 'desc' ? 'Desc' : 'Asc'}</span>
                </button>
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
