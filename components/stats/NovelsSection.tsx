'use client';

import { useState, useMemo, useRef, useCallback, memo } from 'react';
import Link from 'next/link';
import { List, Grid, Star, ChevronDown, BookOpen, Search, X, Loader2, Info } from 'lucide-react';
import { Pagination, PaginationSkeleton } from '@/components/browse/Pagination';
import type { VNDBListItem } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl, getTinySrc, type ImageWidth } from '@/lib/vndb-image-cache';
import { COMPACT_CARD_IMAGE_WIDTH, COMPACT_CARD_IMAGE_SIZES } from '@/components/vn/card-image-utils';
import { LanguageFilter, LanguageFilterValue } from './LanguageFilter';
import { useDisplayTitle, useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { NSFWImage, isNsfwContent } from '@/components/NSFWImage';
import { usePreloadBuffer, PRELOAD_DEFAULTS, PRELOAD_COUNT } from '@/lib/use-preload-buffer';
import { useImageLoadState } from '@/lib/use-image-load-state';
import { prefetchVNImages } from '@/lib/prefetch-vn-images';

type ViewMode = 'list' | 'gallery';
type SortOption = 'score' | 'rating' | 'title' | 'date';
type StatusFilter = 'all' | 'completed' | 'playing' | 'stalled' | 'dropped' | 'wishlist';

interface NovelsSectionProps {
  novels: VNDBListItem[];
  /** Whether novels are currently being loaded */
  isLoading?: boolean;
}

// VNDB Label IDs: 1=Playing, 2=Finished, 3=Stalled, 4=Dropped, 5=Wishlist
const LABEL_IDS: Record<StatusFilter, number | null> = {
  all: null,
  playing: 1,
  completed: 2,
  stalled: 3,
  dropped: 4,
  wishlist: 5,
};

const STATUS_COLORS: Record<string, string> = {
  playing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  stalled: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  dropped: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  wishlist: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

function getStatusFromLabels(labels?: Array<{ id: number; label?: string }>): string {
  if (!labels || labels.length === 0) return 'unknown';
  // Priority: finished > playing > stalled > dropped > wishlist
  if (labels.some(l => l.id === 2)) return 'completed';
  if (labels.some(l => l.id === 1)) return 'playing';
  if (labels.some(l => l.id === 3)) return 'stalled';
  if (labels.some(l => l.id === 4)) return 'dropped';
  if (labels.some(l => l.id === 5)) return 'wishlist';
  return 'unknown';
}

const ITEMS_PER_PAGE = 30;
const SKELETON_COUNT = 18;
// srcSet widths for compact gallery cards
const COMPACT_SRCSET_WIDTHS: ImageWidth[] = [128, 256];
// Preload at the largest srcset width so the preloaded image matches what
// retina browsers actually render (2x DPR picks 256w, not 128w).
const COMPACT_PRELOAD_WIDTH: ImageWidth = 256;

export function NovelsSection({ novels, isLoading = false }: NovelsSectionProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('gallery');
  const [sortBy, setSortBy] = useState<SortOption>('score');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('completed');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [langFilter, setLangFilter] = useState<LanguageFilterValue>('ja');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const { preference: titlePreference } = useTitlePreference();

  const isPaginatingRef = useRef(false);
  // Scroll target for bottom pagination (scrolls to section, not window top)
  const sectionRef = useRef<HTMLDivElement>(null);

  const filteredAndSorted = useMemo(() => {
    // Filter by status
    let filtered = novels;
    const labelId = LABEL_IDS[statusFilter];
    if (labelId !== null) {
      filtered = novels.filter(novel =>
        novel.labels?.some(l => l.id === labelId)
      );
    }

    // Filter by language
    if (langFilter === 'ja') {
      filtered = filtered.filter(novel => novel.vn?.olang === 'ja');
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(novel => {
        if (!novel.vn) return false;
        const title = novel.vn.title?.toLowerCase() || '';
        const titleJp = novel.vn.title_jp?.toLowerCase() || '';
        return title.includes(query) || titleJp.includes(query);
      });
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'score':
          // Sort by user vote descending, nulls last
          const aScore = a.vote ?? -1;
          const bScore = b.vote ?? -1;
          return bScore - aScore;
        case 'rating':
          // Sort by global rating descending, nulls last
          const aRating = a.vn?.rating ?? -1;
          const bRating = b.vn?.rating ?? -1;
          return bRating - aRating;
        case 'title':
          // Sort by display title based on user preference
          const aTitle = a.vn ? getDisplayTitle({ title: a.vn.title, title_jp: a.vn.title_jp, title_romaji: a.vn.title_romaji }, titlePreference) : '';
          const bTitle = b.vn ? getDisplayTitle({ title: b.vn.title, title_jp: b.vn.title_jp, title_romaji: b.vn.title_romaji }, titlePreference) : '';
          return aTitle.localeCompare(bTitle);
        case 'date':
          // Sort by release date descending
          const aDate = a.vn?.released || '0000';
          const bDate = b.vn?.released || '0000';
          return bDate.localeCompare(aDate);
        default:
          return 0;
      }
    });

    return sorted;
  }, [novels, statusFilter, sortBy, langFilter, searchQuery, titlePreference]);

  // Reset to page 1 when filters change
  const [prevFilters, setPrevFilters] = useState({ statusFilter, langFilter, sortBy, searchQuery });
  if (prevFilters.statusFilter !== statusFilter || prevFilters.langFilter !== langFilter || prevFilters.sortBy !== sortBy || prevFilters.searchQuery !== searchQuery) {
    setCurrentPage(1);
    setPrevFilters({ statusFilter, langFilter, sortBy, searchQuery });
    isPaginatingRef.current = false; // Filter change → use full preload buffer
  }

  // Pagination
  const totalPages = Math.ceil(filteredAndSorted.length / ITEMS_PER_PAGE);
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSorted.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredAndSorted, currentPage]);

  // Returns URLs to preload for a given novel (main image + NSFW micro-thumbnail)
  const getPreloadUrls = useCallback((novel: VNDBListItem) => {
    const urls: string[] = [];
    if (novel.vn?.image?.url) {
      const url = getProxiedImageUrl(novel.vn.image.url, { width: COMPACT_PRELOAD_WIDTH, vnId: novel.id });
      if (url) {
        urls.push(url);
        if (isNsfwContent(novel.vn.image?.sexual)) urls.push(getTinySrc(url));
      }
    }
    return urls;
  }, []);

  // Preload buffer — old gallery items stay visible while new page images load.
  // Pagination uses lighter config (shorter timeout). List view disables preloading.
  const preloadConfig = isPaginatingRef.current
    ? { preloadCount: PRELOAD_COUNT, threshold: 0.9, timeoutMs: 150 }
    : PRELOAD_DEFAULTS;
  const { displayItems: displayedItems, isSwapping: isPreloading } = usePreloadBuffer(
    paginatedItems, getPreloadUrls,
    { isLoading, config: preloadConfig, disabled: viewMode === 'list' },
  );

  // Handle page change — sets pagination flag so preload buffer kicks in
  const handlePageChange = useCallback((page: number) => {
    isPaginatingRef.current = true;
    setCurrentPage(page);
  }, []);

  // Preload images from target page on hover (Pagination calls this on mouseenter)
  const handlePrefetchPage = useCallback((page: number) => {
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const pageItems = filteredAndSorted.slice(startIndex, startIndex + PRELOAD_COUNT);
    prefetchVNImages(
      pageItems
        .filter(n => n.vn?.image?.url)
        .map(n => ({ imageUrl: n.vn!.image!.url, vnId: n.id, imageSexual: n.vn!.image!.sexual })),
      COMPACT_PRELOAD_WIDTH,
    );
  }, [filteredAndSorted]);

  const sortLabels: Record<SortOption, string> = {
    score: 'My Score',
    rating: 'Global Rating',
    title: 'Title',
    date: 'Release Date',
  };

  const filterLabels: Record<StatusFilter, string> = {
    all: 'All',
    completed: 'Completed',
    playing: 'Playing',
    stalled: 'Stalled',
    dropped: 'Dropped',
    wishlist: 'Wishlist',
  };

  // Count items per status for filter dropdown
  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: novels.length,
      completed: 0,
      playing: 0,
      stalled: 0,
      dropped: 0,
      wishlist: 0,
    };
    for (const novel of novels) {
      const status = getStatusFromLabels(novel.labels);
      if (status in counts) {
        counts[status as StatusFilter]++;
      }
    }
    return counts;
  }, [novels]);

  const isBusy = isLoading || isPreloading;

  return (
    <div ref={sectionRef} className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none scroll-mt-20">
      {/* Header with title and filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Visual Novels ({filteredAndSorted.length}{langFilter === 'ja' ? ' JP' : ''})
          </h3>
          <span
            className="cursor-help"
            title={`Count based on VNDB database dump (updated daily). May differ slightly from live VNDB.${langFilter === 'ja' ? ' Filtered to Japanese language VNs only.' : ''}`}
          >
            <Info className="w-4 h-4 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" />
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Language Filter */}
          <LanguageFilter value={langFilter} onChange={setLangFilter} />

          {/* Status Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setFilterDropdownOpen(!filterDropdownOpen);
                setSortDropdownOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <span>{filterLabels[statusFilter]}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            {filterDropdownOpen && (
              <div className="absolute right-0 mt-1 py-1 w-40 bg-white dark:bg-gray-700 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 z-10">
                {(Object.keys(filterLabels) as StatusFilter[]).map((status) => (
                  <button
                    key={status}
                    onClick={() => {
                      setStatusFilter(status);
                      setFilterDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-600 flex justify-between ${
                      statusFilter === status ? 'text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <span>{filterLabels[status]}</span>
                    <span className="text-gray-400">{statusCounts[status]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sort Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setSortDropdownOpen(!sortDropdownOpen);
                setFilterDropdownOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <span>Sort: {sortLabels[sortBy]}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            {sortDropdownOpen && (
              <div className="absolute right-0 mt-1 py-1 w-40 bg-white dark:bg-gray-700 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 z-10">
                {(Object.keys(sortLabels) as SortOption[]).map((option) => (
                  <button
                    key={option}
                    onClick={() => {
                      setSortBy(option);
                      setSortDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-600 ${
                      sortBy === option ? 'text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {sortLabels[option]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* View Toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-gray-600 shadow-xs'
                  : 'hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('gallery')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'gallery'
                  ? 'bg-white dark:bg-gray-600 shadow-xs'
                  : 'hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
              title="Gallery view"
            >
              <Grid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Search Bar - right aligned */}
      <div className="flex justify-end mb-5">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by title, Japanese name, or alias..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-2 text-sm bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder-gray-400 dark:placeholder-gray-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>
      </div>

      {/* Skeleton Loading State - shown during initial API load AND initial image preload */}
      {((isLoading && novels.length === 0) || (novels.length > 0 && displayedItems.length === 0 && filteredAndSorted.length > 0)) && (
        <>
          <PaginationSkeleton />
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 my-4">
            {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <div key={i} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg overflow-hidden">
                <div className="aspect-3/4 image-placeholder" />
                <div className="p-3 space-y-2">
                  <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded-sm image-placeholder" />
                  <div className="h-3 w-16 bg-gray-200 dark:bg-gray-600 rounded-sm image-placeholder" />
                </div>
              </div>
            ))}
          </div>
          <PaginationSkeleton />
        </>
      )}

      {/* Content with loading overlay — hidden during initial preload (skeleton covers it) */}
      {novels.length > 0 && (displayedItems.length > 0 || filteredAndSorted.length === 0) && (
        <div className="relative">
          {/* Loading overlay - only during initial data refresh, NOT during pagination */}
          <div
            className={`absolute inset-0 z-10 flex items-center justify-center
              bg-gray-50/70 dark:bg-gray-900/70 backdrop-blur-[1px]
              transition-opacity duration-200 ease-out
              ${isLoading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
          </div>

          {/* Pagination Top */}
          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              onPrefetchPage={handlePrefetchPage}
              totalItems={filteredAndSorted.length}
              itemsPerPage={ITEMS_PER_PAGE}
            />
          )}

          {/* Empty state */}
          {filteredAndSorted.length === 0 && !isLoading && (
            <div className="text-center py-12">
              <BookOpen className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-gray-500 dark:text-gray-400">
                {searchQuery
                  ? `No visual novels found matching "${searchQuery}".`
                  : 'No visual novels found with this filter.'}
              </p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-2 text-sm text-primary-600 dark:text-primary-400 hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
          )}

          {/* List View */}
          {viewMode === 'list' && filteredAndSorted.length > 0 && (
            <div className={`divide-y divide-gray-100 dark:divide-gray-700 ${isBusy ? 'pointer-events-none' : ''}`}>
              {displayedItems.map((novel) => (
                <NovelRow key={novel.id} novel={novel} />
              ))}
            </div>
          )}

          {/* Gallery View */}
          {viewMode === 'gallery' && filteredAndSorted.length > 0 && (
            <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 ${isBusy ? 'pointer-events-none' : ''}`}>
              {displayedItems.map((novel) => (
                <NovelCard key={novel.id} novel={novel} />
              ))}
            </div>
          )}

          {/* Pagination Bottom */}
          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              onPrefetchPage={handlePrefetchPage}
              totalItems={filteredAndSorted.length}
              itemsPerPage={ITEMS_PER_PAGE}
              scrollTargetRef={sectionRef}
            />
          )}
        </div>
      )}
    </div>
  );
}

const NovelRow = memo(function NovelRow({ novel }: { novel: VNDBListItem }) {
  const getDisplayTitle = useDisplayTitle();

  const userScore = novel.vote ? (novel.vote / 10).toFixed(1) : '-';
  const globalRating = novel.vn?.rating ? novel.vn.rating.toFixed(1) : '-';
  const releaseYear = novel.vn?.released?.substring(0, 4) || '-';
  const status = getStatusFromLabels(novel.labels);
  const statusColor = STATUS_COLORS[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
  const displayTitle = novel.vn ? getDisplayTitle({ title: novel.vn.title, title_jp: novel.vn.title_jp, title_romaji: novel.vn.title_romaji }) : novel.id;

  const baseImageUrl = novel.vn?.image?.url ? getProxiedImageUrl(novel.vn.image.url, { width: 128, vnId: novel.id }) : null;
  const { imageUrl, showImage, imageLoaded, handleImageLoad, handleImageError } = useImageLoadState(novel.id, baseImageUrl);
  const imageError = !showImage && !!baseImageUrl;

  return (
    <Link
      href={`/vn/${novel.id}`}
      className="flex items-center gap-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors -mx-2 px-2 rounded-lg"
    >
      {/* Thumbnail */}
      <div className="shrink-0 w-12 h-16 relative rounded-sm overflow-hidden bg-gray-200 dark:bg-gray-700">
        {showImage && !imageLoaded && (
          <div className="absolute inset-0 image-placeholder" />
        )}
        {showImage ? (
          <NSFWImage
            src={imageUrl}
            alt={typeof displayTitle === 'string' ? displayTitle : ''}
            vnId={novel.id}
            imageSexual={novel.vn?.image?.sexual}
            className={`w-full h-full object-cover object-top ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading="lazy"
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        ) : !imageError ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400">
            <BookOpen className="w-5 h-5" />
          </div>
        ) : null}
      </div>

      {/* Title and info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-gray-900 dark:text-white truncate">
          {displayTitle}
        </h4>
        <div className="flex items-center gap-2 mt-1 text-sm text-gray-500 dark:text-gray-400">
          <span>{releaseYear}</span>
          <span className={`px-1.5 py-0.5 text-xs rounded-sm ${statusColor}`}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </div>
      </div>

      {/* Scores */}
      <div className="flex items-center gap-4 text-sm">
        <div className="text-right">
          <div className="text-xs text-gray-400 dark:text-gray-500">My Score</div>
          <div className={`font-medium ${novel.vote ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400'}`}>
            {userScore}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-400 dark:text-gray-500">Global</div>
          <div className="flex items-center gap-1 text-gray-700 dark:text-gray-300">
            <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
            {globalRating}
          </div>
        </div>
      </div>
    </Link>
  );
});

const NovelCard = memo(function NovelCard({ novel }: { novel: VNDBListItem }) {
  const getDisplayTitle = useDisplayTitle();

  const userScore = novel.vote ? (novel.vote / 10).toFixed(1) : null;
  const globalRating = novel.vn?.rating ? novel.vn.rating.toFixed(1) : null;
  const displayTitle = novel.vn ? getDisplayTitle({ title: novel.vn.title, title_jp: novel.vn.title_jp, title_romaji: novel.vn.title_romaji }) : novel.id;

  const baseImageUrl = novel.vn?.image?.url ? getProxiedImageUrl(novel.vn.image.url, { width: COMPACT_CARD_IMAGE_WIDTH, vnId: novel.id }) : null;
  const { imageUrl, showImage, imageLoaded, retryKey, handleImageLoad, handleImageError } = useImageLoadState(novel.id, baseImageUrl);
  const imageError = !showImage && !!baseImageUrl;

  // Build srcset with retry cache-buster
  const srcSet = novel.vn?.image?.url
    ? COMPACT_SRCSET_WIDTHS
        .map(w => {
          const url = getProxiedImageUrl(novel.vn!.image!.url, { width: w, vnId: novel.id });
          return url ? `${url}${retryKey > 0 ? `${url.includes('?') ? '&' : '?'}_r=${retryKey}` : ''} ${w}w` : null;
        })
        .filter(Boolean)
        .join(', ')
    : undefined;

  return (
    <div
      className="group bg-gray-50 dark:bg-gray-700/50 rounded-lg overflow-hidden sm:shadow-xs sm:hover:shadow-md sm:transition-shadow"
    >
      {/* Image */}
      <Link href={`/vn/${novel.id}`} className="block relative aspect-3/4">
        {/* Shimmer placeholder — unmounted once image loads (no flash for preloaded images) */}
        {showImage && !imageLoaded && (
          <div className="absolute inset-0 image-placeholder" />
        )}
        {showImage ? (
          <NSFWImage
            src={imageUrl}
            alt={displayTitle}
            vnId={novel.id}
            imageSexual={novel.vn?.image?.sexual}
            className={`absolute inset-0 w-full h-full object-cover object-top ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading="lazy"
            srcSet={srcSet}
            sizes={COMPACT_CARD_IMAGE_SIZES}
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        ) : !imageError ? (
          <div className="absolute inset-0 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-400">
            <BookOpen className="w-6 h-6" />
          </div>
        ) : null}

        {/* User score badge */}
        {userScore && (
          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-primary-600 text-white text-[11px] font-semibold rounded-sm z-10">
            {userScore}
          </div>
        )}

        {/* Global rating badge */}
        {globalRating && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 px-1.5 py-0.5 bg-black/70 text-white text-[11px] font-medium rounded-sm z-10">
            <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
            {globalRating}
          </div>
        )}
      </Link>

      {/* Title */}
      <div className="p-2">
        <Link href={`/vn/${novel.id}`}>
          <h4 className="font-medium text-xs text-gray-900 dark:text-white line-clamp-2 leading-tight group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
            {displayTitle}
          </h4>
        </Link>
        {novel.vn?.released && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            {novel.vn.released.substring(0, 4)}
          </p>
        )}
      </div>
    </div>
  );
});
