'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { mutate } from 'swr';
import { vndbStatsApi, BrowseSeiyuuItem, BrowseSeiyuuParams } from '@/lib/vndb-stats-api';
import { useBrowseSeiyuu } from '@/lib/vndb-stats-cached';
import { stripBBCode } from '@/lib/bbcode';
import { useTitlePreference } from '@/lib/title-preference';
import { AlphabetFilter } from './AlphabetFilter';
import { Pagination, PaginationSkeleton } from './Pagination';
import { EntityTable, EntityColumn, NameCell, CountCell } from './EntityTable';
import { EntityCards, EntityCard } from './EntityCards';
import { SimpleSelect } from './SimpleSelect';
import { EntityViewToggle, ViewMode } from './EntityViewToggle';
import { RandomButton } from './RandomButton';

const GENDER_OPTIONS = [
  { value: '', label: 'Any Gender' },
  { value: 'm', label: 'Male' },
  { value: 'f', label: 'Female' },
];

const LANG_OPTIONS = [
  { value: '', label: 'Any Language' },
  { value: 'ja', label: 'Japanese' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
];

const ITEMS_PER_PAGE = 50;
const FILTER_DEBOUNCE_MS = 150;
const SEARCH_DEBOUNCE_MS = 300;


interface BrowseSeiyuuTabProps {
  isActive?: boolean;
}

export function BrowseSeiyuuTab({ isActive = true }: BrowseSeiyuuTabProps) {
  const { preference } = useTitlePreference();
  const [params, setParams] = useState<BrowseSeiyuuParams>({
    sort: 'vn_count',
    sort_order: 'desc',
    page: 1,
    limit: ITEMS_PER_PAGE,
    lang: 'ja',
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
  const { data, isLoading, isValidating } = useBrowseSeiyuu(debouncedParams, isActive);

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

  const updateParams = (updates: Partial<BrowseSeiyuuParams>) => {
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

  // Prefetch a page into SWR cache for instant navigation
  const handlePrefetchPage = useCallback((targetPage: number) => {
    if (targetPage < 1 || targetPage > pages) return;
    const prefetchParams = { ...debouncedParams, page: targetPage };
    const key = ['browseSeiyuu', JSON.stringify(prefetchParams)];
    mutate(key, vndbStatsApi.browseSeiyuu(prefetchParams), { revalidate: false });
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

  const columns: EntityColumn<BrowseSeiyuuItem>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (item) => <NameCell name={item.name} original={item.original} preference={preference} />,
    },
    {
      key: 'gender',
      label: 'Gender',
      render: (item) => (
        <span className="text-gray-600 dark:text-gray-400">
          {item.gender === 'm' ? 'Male' : item.gender === 'f' ? 'Female' : '—'}
        </span>
      ),
    },
    {
      key: 'lang',
      label: 'Language',
      render: (item) => (
        <span className="text-gray-600 dark:text-gray-400 uppercase text-xs">{item.lang || '—'}</span>
      ),
    },
    {
      key: 'vn_count',
      label: 'VN Count',
      className: 'text-right',
      render: (item) => <CountCell count={item.vn_count} />,
    },
    {
      key: 'character_count',
      label: 'Characters',
      className: 'text-right',
      render: (item) => <CountCell count={item.character_count} />,
    },
    {
      key: 'description',
      label: 'Description',
      className: 'max-w-md',
      render: (item) => (
        <span className="text-gray-500 dark:text-gray-400 text-xs line-clamp-2">
          {item.description ? stripBBCode(item.description) : '—'}
        </span>
      ),
    },
  ];

  // Show loading state only on initial load (no data yet)
  const showLoadingSkeleton = !data;
  // Show subtle loading indicator when revalidating with existing data
  const showLoadingIndicator = !data || isLoading || isValidating;

  return (
    <div className="space-y-4">
      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search seiyuu..."
            className="w-full pl-9 pr-8 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <SimpleSelect
            options={LANG_OPTIONS}
            value={params.lang || ''}
            onChange={(v) => updateParams({ lang: v || undefined })}
          />
          <SimpleSelect
            options={GENDER_OPTIONS}
            value={params.gender || ''}
            onChange={(v) => updateParams({ gender: v || undefined })}
          />
        </div>
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
        <span className="text-sm text-gray-600 dark:text-gray-400">
          <span><span className="font-semibold text-gray-900 dark:text-white">{total.toLocaleString()}</span> seiyuu</span>
        </span>
        <div className="flex items-center gap-2">
          <SimpleSelect
            options={[{ value: 'vn_count', label: 'VN Count' }, { value: 'character_count', label: 'Characters' }, { value: 'name', label: 'Name' }]}
            value={params.sort || 'vn_count'}
            onChange={(v) => updateParams({ sort: v as BrowseSeiyuuParams['sort'] })}
            compact
          />
          <button
            onClick={() => updateParams({ sort_order: params.sort_order === 'desc' ? 'asc' : 'desc' })}
            className="px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300"
          >
            {params.sort_order === 'desc' ? '↓' : '↑'}
            <span className="hidden sm:inline text-xs ml-1">{params.sort_order === 'desc' ? 'Desc' : 'Asc'}</span>
          </button>
          <RandomButton entityType="seiyuu" />
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
          totalItems={total}
          itemsPerPage={ITEMS_PER_PAGE}
        />
      ) : null}

      {/* Results — key change on data arrival triggers fade-in animation */}
      <div key={showLoadingSkeleton ? 'loading' : 'loaded'} className={showLoadingSkeleton ? undefined : 'animate-fade-in'}>
      {viewMode === 'table' ? (
        <EntityTable
          items={items}
          columns={columns}
          getKey={(item) => item.id}
          getLink={(item) => `/stats/seiyuu/${item.id}`}
          isLoading={showLoadingIndicator}
        />
      ) : (
        <EntityCards isLoading={showLoadingSkeleton} isValidating={isValidating && items.length > 0} isEmpty={items.length === 0 && !showLoadingIndicator}>
          {items.map((item) => {
            const displayName = preference === 'romaji' && item.original ? item.original : item.name;
            const altName = preference === 'romaji' && item.original ? item.name : item.original;
            return (
              <EntityCard
                key={item.id}
                link={`/stats/seiyuu/${item.id}`}
                title={displayName}
                subtitle={altName && altName !== displayName ? altName : undefined}
                fields={[
                  { label: 'Language', value: item.lang?.toUpperCase() || '—' },
                  { label: 'Gender', value: item.gender === 'm' ? 'Male' : item.gender === 'f' ? 'Female' : '—' },
                  { label: 'VN Count', value: item.vn_count.toLocaleString() },
                  { label: 'Characters', value: item.character_count.toLocaleString() },
                ]}
                rightContent={
                  <div className="text-right">
                    <span className="text-lg font-bold text-primary-600 dark:text-primary-400">{item.vn_count.toLocaleString()}</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">VNs</p>
                  </div>
                }
                badges={undefined}
              />
            );
          })}
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
          totalItems={total}
          itemsPerPage={ITEMS_PER_PAGE}
          scrollTargetRef={resultsRef}
        />
      )}

    </div>
  );
}
