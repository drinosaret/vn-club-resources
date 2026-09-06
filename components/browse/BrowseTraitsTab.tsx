'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { mutate } from 'swr';
import { vndbStatsApi, BrowseTraitItem, BrowseTraitParams } from '@/lib/vndb-stats-api';
import { useBrowseTraits } from '@/lib/vndb-stats-cached';
import { stripBBCode } from '@/lib/bbcode';
import { AlphabetFilter } from './AlphabetFilter';
import { Pagination, PaginationSkeleton } from './Pagination';
import { EntityTable, EntityColumn, BadgeCell, CountCell } from './EntityTable';
import { EntityCards, EntityCard } from './EntityCards';
import { SimpleSelect } from './SimpleSelect';
import { EntityViewToggle, ViewMode } from './EntityViewToggle';
import { RandomButton } from './RandomButton';

const GROUP_OPTIONS = [
  { value: '', label: 'All Groups' },
  { value: 'Hair', label: 'Hair' },
  { value: 'Eyes', label: 'Eyes' },
  { value: 'Body', label: 'Body' },
  { value: 'Clothes', label: 'Clothes' },
  { value: 'Items', label: 'Items' },
  { value: 'Personality', label: 'Personality' },
  { value: 'Role', label: 'Role' },
  { value: 'Engages in', label: 'Engages in' },
  { value: 'Subject of', label: 'Subject of' },
  { value: 'Engages in (Sexual)', label: 'Engages in (Sexual)' },
  { value: 'Subject of (Sexual)', label: 'Subject of (Sexual)' },
];


const ITEMS_PER_PAGE = 50;
const FILTER_DEBOUNCE_MS = 150;
const SEARCH_DEBOUNCE_MS = 300;

interface BrowseTraitsTabProps {
  isActive?: boolean;
}

export function BrowseTraitsTab({ isActive = true }: BrowseTraitsTabProps) {
  const [params, setParams] = useState<BrowseTraitParams>({
    sort: 'char_count',
    sort_order: 'desc',
    page: 1,
    limit: ITEMS_PER_PAGE,
  });
  const [searchInput, setSearchInput] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [debouncedParams, setDebouncedParams] = useState(params);

  // Ref for debouncing filter changes
  const filterDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  // Ref for scroll target (results header area)
  const resultsRef = useRef<HTMLDivElement>(null);

  // Use SWR for data fetching with caching
  const { data, error, isLoading, isValidating } = useBrowseTraits(debouncedParams, isActive);

  // Default data structure
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  const pages = data?.pages ?? 1;

  // Default to card view on mobile (runs before data loads, so no visual flash)
  useEffect(() => {
    if (window.innerWidth < 768) setViewMode('cards');
  }, []);

  // Cleanup debounce timeouts on unmount
  useEffect(() => {
    return () => {
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const updateParams = (updates: Partial<BrowseTraitParams>) => {
    const updated = { ...params, ...updates, page: updates.page ?? 1 };
    setParams(updated);

    // Immediate update for pagination only, debounced for other filters
    if (updates.page !== undefined && Object.keys(updates).length === 1) {
      setDebouncedParams(updated);
    } else {
      if (filterDebounceRef.current) {
        clearTimeout(filterDebounceRef.current);
      }
      filterDebounceRef.current = setTimeout(() => {
        setDebouncedParams(updated);
      }, FILTER_DEBOUNCE_MS);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      updateParams({ q: value || undefined });
    }, SEARCH_DEBOUNCE_MS);
  };

  const getPageHref = useCallback((page: number) => {
    if (typeof window === 'undefined') return '#';
    const params = new URLSearchParams(window.location.search);
    params.set('tab', 'traits');
    if (page > 1) params.set('page', String(page));
    else params.delete('page');
    return `/browse/?${params.toString()}`;
  }, []);

  // Prefetch a page into SWR cache for instant navigation
  const handlePrefetchPage = useCallback((targetPage: number) => {
    if (targetPage < 1 || targetPage > pages) return;
    const prefetchParams = { ...debouncedParams, page: targetPage };
    const key = ['browseTraits', JSON.stringify(prefetchParams)];
    mutate(key, vndbStatsApi.browseTraits(prefetchParams), { revalidate: false });
  }, [debouncedParams, pages]);

  // Background prefetch adjacent pages after data loads
  useEffect(() => {
    if (!data || isLoading) return;
    const timer = setTimeout(() => {
      if (page < pages) {
        handlePrefetchPage(page + 1);
        if (page + 1 < pages) handlePrefetchPage(page + 2);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [data, page, pages, isLoading, handlePrefetchPage]);

  const columns: EntityColumn<BrowseTraitItem>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (item) => <span className="text-[color:var(--ink)]">{item.name}</span>,
    },
    {
      key: 'group_name',
      label: 'Group',
      render: (item) => item.group_name ? (
        <BadgeCell value={item.group_name} />
      ) : <span className="text-[color:var(--text-faint)]">—</span>,
    },
    {
      key: 'char_count',
      label: 'Characters',
      className: 'text-right',
      render: (item) => <CountCell count={item.char_count} />,
    },
    {
      key: 'description',
      label: 'Description',
      className: 'max-w-md',
      render: (item) => (
        <span className="text-[color:var(--nezu)] text-xs line-clamp-2">
          {item.description ? stripBBCode(item.description) : '—'}
        </span>
      ),
    },
  ];

  // Show loading state only on initial load (no data yet)
  // A stale page from an earlier query is worth keeping on screen. A failure with nothing
  // behind it has to stop the skeleton, or the panel waits for data that is not coming.
  const failed = Boolean(error) && items.length === 0;
  const showLoadingSkeleton = !data && !failed;
  // Show subtle loading indicator when revalidating with existing data
  const showLoadingIndicator = (!data && !failed) || isLoading || isValidating;

  return (
    <div className="space-y-4">
      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--text-faint)]" />
          <input
            type="search"
            autoComplete="off"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search traits..."
            className="bw-field w-full pl-9 pr-8 py-2 text-sm"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => handleSearchChange('')}
              className="bw-chip-btn absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <SimpleSelect
          options={GROUP_OPTIONS}
          value={params.group_name || ''}
          onChange={(v) => updateParams({ group_name: v || undefined })}
        />
      </div>

      {/* Alphabet Filter */}
      <AlphabetFilter
        activeChar={params.first_char || null}
        onSelect={(char) => {
          updateParams({ first_char: char || undefined });
        }}
      />

      {/* Results Header */}
      <div ref={resultsRef} className="scroll-mt-20 flex items-center justify-between">
        <span className="text-sm text-[color:var(--nezu)]">
          <span><span className="bw-num text-[color:var(--ink)]">{total.toLocaleString()}</span> traits</span>
        </span>
        <div className="flex items-center gap-2">
          <SimpleSelect
            options={[{ value: 'char_count', label: 'Character Count' }, { value: 'name', label: 'Name' }]}
            value={params.sort || 'char_count'}
            onChange={(v) => updateParams({ sort: v as BrowseTraitParams['sort'] })}
            compact
          />
          <button
            onClick={() => updateParams({ sort_order: params.sort_order === 'desc' ? 'asc' : 'desc' })}
            className="tab"
          >
            {params.sort_order === 'desc' ? '↓' : '↑'}
            <span className="hidden sm:inline text-xs ml-1">{params.sort_order === 'desc' ? 'Desc' : 'Asc'}</span>
          </button>
          <RandomButton entityType="traits" />
          <EntityViewToggle mode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {/* Pagination Top - show skeleton during initial load to reserve space */}
      {showLoadingSkeleton ? (
        <PaginationSkeleton />
      ) : pages > 1 ? (
        <Pagination
          currentPage={page}
          totalPages={pages}
          onPageChange={(p) => updateParams({ page: p })}
          onPrefetchPage={handlePrefetchPage}
          getPageHref={getPageHref}
          totalItems={total}
          itemsPerPage={ITEMS_PER_PAGE}
        />
      ) : null}

      {/* Results: key change on data arrival triggers fade-in animation */}
      <div key={showLoadingSkeleton ? 'loading' : 'loaded'} className={showLoadingSkeleton ? undefined : 'animate-fade-in'}>
      {viewMode === 'table' ? (
        <EntityTable
          items={items}
          columns={columns}
          getKey={(item) => item.id}
          getLink={(item) => `/stats/trait/i${item.id}`}
          isLoading={showLoadingIndicator}
          failed={failed}
        />
      ) : (
        <EntityCards
          isLoading={showLoadingSkeleton}
          isValidating={isValidating && items.length > 0}
          isEmpty={items.length === 0 && !showLoadingIndicator && !failed}
          failed={failed}
        >
          {items.map((item) => (
            <EntityCard
              key={item.id}
              link={`/stats/trait/i${item.id}`}
              title={item.name}
              fields={[
                { label: 'Group', value: item.group_name || '—' },
                { label: 'Characters', value: item.char_count.toLocaleString() },
              ]}
              rightContent={
                <span className="bw-num text-lg text-[color:var(--ai)]">{item.char_count.toLocaleString()}</span>
              }
              badges={item.group_name ? (
                <span className="bw-badge">
                  {item.group_name}
                </span>
              ) : undefined}
            />
          ))}
        </EntityCards>
      )}
      </div>

      {/* Pagination Bottom - scrolls to results header on page change */}
      {!showLoadingSkeleton && pages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={pages}
          onPageChange={(p) => updateParams({ page: p })}
          onPrefetchPage={handlePrefetchPage}
          getPageHref={getPageHref}
          totalItems={total}
          itemsPerPage={ITEMS_PER_PAGE}
          scrollTargetRef={resultsRef}
        />
      )}

    </div>
  );
}

