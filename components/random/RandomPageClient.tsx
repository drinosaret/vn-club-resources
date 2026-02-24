'use client';

import { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, AlertCircle, RefreshCw, Dices, X, Eye, EyeOff } from 'lucide-react';
import { vndbStatsApi, VNSearchResult, BrowseFilters } from '@/lib/vndb-stats-api';
import { useTitlePreference } from '@/lib/title-preference';
import { VNGrid } from '../browse/VNGrid';
import { TagFilter, SelectedTag, FilterEntityType } from '../browse/TagFilter';
import { CompactFilterBar } from '../browse/CompactFilterBar';
import { ActiveFilterChips } from '../browse/ActiveFilterChips';
import { InlineRangeSliders } from '../browse/InlineRangeSliders';
import { MobileFilterPanel } from '../browse/MobileFilterPanel';
import { SidebarFilters } from '../browse/SidebarFilters';
import { SimpleSelect } from '../browse/SimpleSelect';
import { VNDBAttribution } from '@/components/VNDBAttribution';

const RESULT_COUNTS = [1, 3, 5, 10] as const;
const DEFAULT_COUNT = 5;
const FILTER_DEBOUNCE_MS = 300;

/** Parse browse filters from URL search params (random-specific: no search, alphabet, sort). */
function parseFiltersFromParams(params: URLSearchParams): BrowseFilters {
  return {
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
    sort: 'random',
    page: 1,
  };
}

/** Parse tag/trait/entity names from URL (stored as "type:id:name,type:id:name"). */
function parseTagsFromUrl(param: string | null, mode: 'include' | 'exclude'): SelectedTag[] {
  if (!param) return [];
  try {
    return param.split(',').map((item) => {
      const [type, id, ...nameParts] = item.split(':');
      return { id, name: nameParts.join(':'), mode, type: type as FilterEntityType };
    });
  } catch {
    return [];
  }
}

interface RandomPageClientProps {
  initialSearchParams: { [key: string]: string | string[] | undefined };
}

export default function RandomPageClient({ initialSearchParams }: RandomPageClientProps) {
  const searchParams = useSearchParams();
  const { preference } = useTitlePreference();

  // Parse initial state from URL (computed once on mount)
  const initialFilters = useMemo(
    () => parseFiltersFromParams(searchParams),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const initialTags = useMemo(() => {
    const includeTags = parseTagsFromUrl(searchParams.get('tag_names'), 'include');
    const excludeTags = parseTagsFromUrl(searchParams.get('exclude_tag_names'), 'exclude');
    return [...includeTags, ...excludeTags];
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const initialCount = useMemo(() => {
    const c = searchParams.get('count');
    const n = c ? Number(c) : DEFAULT_COUNT;
    return RESULT_COUNTS.includes(n as any) ? n : DEFAULT_COUNT;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // State
  const [filters, setFilters] = useState<BrowseFilters>(initialFilters);
  const [selectedTags, setSelectedTags] = useState<SelectedTag[]>(initialTags);
  const [resultCount, setResultCount] = useState(initialCount);
  const [results, setResults] = useState<VNSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [skipPreload, setSkipPreload] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [mobileFiltersExpanded, setMobileFiltersExpanded] = useState(false);

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingFiltersRef = useRef(initialFilters);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedTagsRef = useRef(initialTags);
  const resultCountRef = useRef(initialCount);

  // Keep tags ref in sync
  useEffect(() => { selectedTagsRef.current = selectedTags; }, [selectedTags]);

  // Resolve tag names from IDs on mount (same pattern as BrowsePageClient)
  useEffect(() => {
    async function resolveTagsFromIds() {
      if (initialTags.length > 0) {
        // Tags from URL already have names — use as-is
        setSelectedTags(initialTags);
        return;
      }

      // Resolve from filter IDs if tag_names not in URL
      const resolvedTags: SelectedTag[] = [];

      if (initialFilters.tags) {
        const tagIds = initialFilters.tags.split(',');
        try {
          const tagMap = await vndbStatsApi.getTags(tagIds);
          for (const [id, t] of tagMap) {
            resolvedTags.push({ id, name: t.name, mode: 'include', type: 'tag' });
          }
        } catch { /* use ID as fallback */ }
      }
      if (initialFilters.traits) {
        const traitIds = initialFilters.traits.split(',');
        try {
          const traitMap = await vndbStatsApi.getTraits(traitIds);
          for (const [id, t] of traitMap) {
            resolvedTags.push({ id, name: t.name, mode: 'include', type: 'trait' });
          }
        } catch { /* use ID as fallback */ }
      }

      // Entity IDs — use ID as name fallback
      const entityParams: { param: string | undefined; type: FilterEntityType }[] = [
        { param: initialFilters.staff, type: 'staff' },
        { param: initialFilters.seiyuu, type: 'seiyuu' },
        { param: initialFilters.developer, type: 'developer' },
        { param: initialFilters.publisher, type: 'publisher' },
      ];
      for (const { param, type } of entityParams) {
        if (param) {
          for (const id of param.split(',').filter(Boolean)) {
            resolvedTags.push({ id, name: id, mode: 'include', type });
          }
        }
      }

      if (resolvedTags.length > 0) {
        setSelectedTags(resolvedTags);
      }
    }
    resolveTagsFromIds();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update URL when filters change
  const updateURL = useCallback((newFilters: BrowseFilters, tags: SelectedTag[], count: number) => {
    const params = new URLSearchParams();

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
    if (newFilters.length) params.set('length', newFilters.length);
    else if (newFilters.exclude_length) params.set('length', '');
    if (newFilters.exclude_length) params.set('exclude_length', newFilters.exclude_length);
    if (newFilters.minage) params.set('minage', newFilters.minage);
    if (newFilters.exclude_minage) params.set('exclude_minage', newFilters.exclude_minage);
    if (newFilters.devstatus && newFilters.devstatus !== '-1') params.set('devstatus', newFilters.devstatus);
    if (newFilters.exclude_devstatus) params.set('exclude_devstatus', newFilters.exclude_devstatus);
    if (newFilters.olang) params.set('olang', newFilters.olang);
    else if (newFilters.exclude_olang) params.set('olang', '');
    if (newFilters.exclude_olang) params.set('exclude_olang', newFilters.exclude_olang);
    if (newFilters.platform) params.set('platform', newFilters.platform);
    else if (newFilters.exclude_platform) params.set('platform', '');
    if (newFilters.exclude_platform) params.set('exclude_platform', newFilters.exclude_platform);
    if (newFilters.spoiler_level !== undefined && newFilters.spoiler_level > 0) params.set('spoiler_level', String(newFilters.spoiler_level));
    if (newFilters.staff) params.set('staff', newFilters.staff);
    if (newFilters.seiyuu) params.set('seiyuu', newFilters.seiyuu);
    if (newFilters.developer) params.set('developer', newFilters.developer);
    if (newFilters.publisher) params.set('publisher', newFilters.publisher);
    if (newFilters.producer) params.set('producer', newFilters.producer);
    if (count !== DEFAULT_COUNT) params.set('count', String(count));

    // Tag/trait names for display
    const includeTags = tags.filter(t => t.mode === 'include');
    const excludeTags = tags.filter(t => t.mode === 'exclude');
    if (includeTags.length > 0) {
      params.set('tag_names', includeTags.map(t => `${t.type}:${t.id}:${t.name}`).join(','));
    }
    if (excludeTags.length > 0) {
      params.set('exclude_tag_names', excludeTags.map(t => `${t.type}:${t.id}:${t.name}`).join(','));
    }

    const queryString = params.toString();
    const url = `/random/${queryString ? `?${queryString}` : ''}`;
    startTransition(() => {
      window.history.replaceState(window.history.state, '', url);
    });
  }, []);

  // Fetch random results. `skip` = true skips VNGrid preload buffer for instant card shimmers.
  const fetchResults = useCallback(async (currentFilters: BrowseFilters, count: number, skip = false) => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setSkipPreload(skip);
    setIsLoading(true);
    setFetchError(null);
    try {
      const response = await vndbStatsApi.browseVNs(
        { ...currentFilters, sort: 'random', page: 1, limit: count },
        abortController.signal,
      );
      if (!abortController.signal.aborted) {
        startTransition(() => {
          setResults(response.results);
          setTotal(response.total);
          setIsLoading(false);
        });
        // Save snapshot for back-nav restoration
        sessionStorage.setItem('random-snapshot', JSON.stringify({
          results: response.results,
          total: response.total,
          filters: currentFilters,
          count,
          url: window.location.href,
        }));
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setFetchError('Failed to connect. Please try again.');
      setResults([]);
      setTotal(0);
      setIsLoading(false);
    }
  }, []);

  // Initial fetch on mount — restore from snapshot on back-nav for instant display
  useEffect(() => {
    const isBackNav = sessionStorage.getItem('is-popstate-navigation') === 'true';
    if (isBackNav) {
      try {
        const raw = sessionStorage.getItem('random-snapshot');
        if (raw) {
          const snap = JSON.parse(raw);
          // Restore if URL matches (same filters)
          if (snap.url === window.location.href && snap.results?.length > 0) {
            startTransition(() => {
              setResults(snap.results);
              setTotal(snap.total);
              setIsLoading(false);
            });
            return;
          }
        }
      } catch { /* corrupt snapshot, fetch fresh */ }
    }
    fetchResults(initialFilters, initialCount);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle filter change (with debounce)
  const handleFilterChange = useCallback((newFilters: Partial<BrowseFilters>) => {
    const updated = { ...pendingFiltersRef.current, ...newFilters, sort: 'random' as const, page: 1 };
    pendingFiltersRef.current = updated;
    setFilters(updated);
    updateURL(updated, selectedTagsRef.current, resultCountRef.current);

    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => {
      fetchResults(pendingFiltersRef.current, resultCountRef.current);
    }, FILTER_DEBOUNCE_MS);
  }, [updateURL, fetchResults]);

  // Handle tag/trait/entity changes (with debounce)
  const handleTagsChange = useCallback((newTags: SelectedTag[]) => {
    setSelectedTags(newTags);
    const includeTags = newTags.filter(t => t.mode === 'include' && t.type === 'tag').map(t => t.id);
    const excludeTags = newTags.filter(t => t.mode === 'exclude' && t.type === 'tag').map(t => t.id);
    const includeTraits = newTags.filter(t => t.mode === 'include' && t.type === 'trait').map(t => t.id);
    const excludeTraits = newTags.filter(t => t.mode === 'exclude' && t.type === 'trait').map(t => t.id);
    const staffIds = newTags.filter(t => t.type === 'staff' && t.mode === 'include').map(t => t.id);
    const seiyuuIds = newTags.filter(t => t.type === 'seiyuu' && t.mode === 'include').map(t => t.id);
    const devIds = newTags.filter(t => t.type === 'developer' && t.mode === 'include').map(t => t.id);
    const pubIds = newTags.filter(t => t.type === 'publisher' && t.mode === 'include').map(t => t.id);

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
    updateURL(updated, newTags, resultCountRef.current);

    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => {
      fetchResults(pendingFiltersRef.current, resultCountRef.current);
    }, FILTER_DEBOUNCE_MS);
  }, [updateURL, fetchResults]);

  // Clear all filters
  const handleClearFilters = useCallback(() => {
    setSelectedTags([]);
    const cleared: BrowseFilters = {
      sort: 'random',
      page: 1,
      devstatus: '-1',
      olang: 'ja',
      include_children: true,
      spoiler_level: 0,
      exclude_length: undefined,
      exclude_minage: undefined,
      exclude_devstatus: undefined,
      exclude_olang: undefined,
      exclude_platform: undefined,
      staff: undefined,
      seiyuu: undefined,
      developer: undefined,
      publisher: undefined,
    };
    pendingFiltersRef.current = cleared;
    setFilters(cleared);
    updateURL(cleared, [], resultCountRef.current);
    fetchResults(cleared, resultCountRef.current);
  }, [updateURL, fetchResults]);

  // Remove single filter (for ActiveFilterChips)
  const handleRemoveFilter = useCallback((filterKey: keyof BrowseFilters, value?: string) => {
    const currentFilters = pendingFiltersRef.current;
    const currentValue = currentFilters[filterKey];

    if (value && typeof currentValue === 'string') {
      const values = currentValue.split(',').map(v => v.trim()).filter(v => v !== value);
      const newValue = values.length > 0 ? values.join(',') : undefined;
      if (filterKey === 'olang' && !newValue) {
        handleFilterChange({ [filterKey]: undefined });
      } else if (filterKey === 'devstatus' && !newValue) {
        handleFilterChange({ [filterKey]: '-1' });
      } else {
        handleFilterChange({ [filterKey]: newValue });
      }
    } else {
      if (filterKey === 'include_children') {
        handleFilterChange({ include_children: true });
      } else if (filterKey === 'spoiler_level') {
        handleFilterChange({ spoiler_level: 0 });
      } else if (filterKey === 'year_min' || filterKey === 'year_max') {
        handleFilterChange({ year_min: undefined, year_max: undefined });
      } else if (filterKey === 'min_rating' || filterKey === 'max_rating') {
        handleFilterChange({ min_rating: undefined, max_rating: undefined });
      } else if (filterKey === 'min_votecount' || filterKey === 'max_votecount') {
        handleFilterChange({ min_votecount: undefined, max_votecount: undefined });
      } else {
        handleFilterChange({ [filterKey]: undefined });
      }
    }
  }, [handleFilterChange]);

  // Remove single tag (for ActiveFilterChips)
  const handleRemoveTag = useCallback((tagId: string, tagType: FilterEntityType) => {
    const newTags = selectedTags.filter(t => !(t.id === tagId && t.type === tagType));
    handleTagsChange(newTags);
  }, [selectedTags, handleTagsChange]);

  // Handle result count change
  const handleCountChange = useCallback((count: number) => {
    setResultCount(count);
    resultCountRef.current = count;
    updateURL(pendingFiltersRef.current, selectedTagsRef.current, count);
    fetchResults(pendingFiltersRef.current, count, true);
  }, [updateURL, fetchResults]);

  // Randomize button — re-fetch with same filters, skip preload for snappy re-rolls
  const handleRandomize = useCallback(() => {
    fetchResults(pendingFiltersRef.current, resultCountRef.current, true);
  }, [fetchResults]);

  // Active filters check
  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.tags || filters.exclude_tags ||
      filters.traits || filters.exclude_traits ||
      (filters.include_children === false) ||
      filters.year_min || filters.year_max ||
      filters.min_rating || filters.max_rating ||
      filters.min_votecount || filters.max_votecount ||
      filters.length || filters.exclude_length ||
      filters.minage || filters.exclude_minage ||
      (filters.devstatus && filters.devstatus !== '-1') ||
      filters.exclude_devstatus ||
      (filters.olang && filters.olang !== 'ja') ||
      filters.exclude_olang ||
      filters.platform || filters.exclude_platform ||
      filters.staff || filters.seiyuu || filters.developer || filters.publisher ||
      (filters.spoiler_level !== undefined && filters.spoiler_level > 0) ||
      selectedTags.length > 0
    );
  }, [filters, selectedTags]);

  // Active filter count for mobile badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.olang && filters.olang !== 'ja') count += filters.olang.split(',').length;
    if (filters.exclude_olang) count += filters.exclude_olang.split(',').length;
    if (filters.platform) count += filters.platform.split(',').length;
    if (filters.exclude_platform) count += filters.exclude_platform.split(',').length;
    if (filters.length) count += filters.length.split(',').length;
    if (filters.exclude_length) count += filters.exclude_length.split(',').length;
    if (filters.minage) count += filters.minage.split(',').length;
    if (filters.exclude_minage) count += filters.exclude_minage.split(',').length;
    if (filters.devstatus && filters.devstatus !== '-1') count += filters.devstatus.split(',').length;
    if (filters.exclude_devstatus) count += filters.exclude_devstatus.split(',').length;
    if (filters.year_min || filters.year_max) count++;
    if (filters.min_rating || filters.max_rating) count++;
    if (filters.min_votecount || filters.max_votecount) count++;
    count += selectedTags.length;
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
            Random Visual Novel
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Discover your next read. Apply filters and roll for random picks.
          </p>
        </div>

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
        </MobileFilterPanel>

        {/* TWO-COLUMN LAYOUT */}
        <div className="lg:flex lg:gap-6">
          {/* LEFT SIDEBAR - Desktop only */}
          <SidebarFilters
            filters={filters}
            onChange={handleFilterChange}
            selectedTags={selectedTags}
            onTagsChange={handleTagsChange}
            activeChar={null}
            onAlphabetClick={() => {}}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={handleClearFilters}
            hideAlphabet
          />

          {/* RIGHT CONTENT */}
          <div className="flex-1 min-w-0">
            {/* Active Filter Chips */}
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
                    onClick={handleRandomize}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry
                  </button>
                </div>
              </div>
            )}

            {/* Random Controls Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3 mt-3">
              <div className="flex items-center gap-4 min-w-0">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      Rolling...
                    </span>
                  ) : (
                    <>
                      <span className="text-gray-700 dark:text-gray-200">{total.toLocaleString()}</span>
                      {' '}matching VNs
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

              <div className="flex items-center gap-2 shrink-0">
                {/* Result count selector */}
                <SimpleSelect
                  options={RESULT_COUNTS.map(n => ({
                    value: String(n),
                    label: `${n} result${n === 1 ? '' : 's'}`,
                  }))}
                  value={String(resultCount)}
                  onChange={(v) => handleCountChange(Number(v))}
                  align="right"
                />

                {/* Randomize button */}
                <button
                  onClick={handleRandomize}
                  disabled={isLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white font-medium rounded-lg text-sm transition-colors"
                >
                  <Dices className="w-4 h-4" />
                  Randomize
                </button>
              </div>
            </div>

            {/* Results Grid */}
            <div>
              <VNGrid
                results={results}
                isLoading={isLoading}
                showOverlay={false}
                isPaginating={skipPreload && isLoading}
                skipPreload={skipPreload}
                preference={preference}
                gridSize="medium"
                skeletonCount={resultCount}
              />
            </div>

            <VNDBAttribution />
          </div>
        </div>
      </div>
    </div>
  );
}
