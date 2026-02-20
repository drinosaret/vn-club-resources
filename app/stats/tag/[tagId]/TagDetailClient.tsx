'use client';

import { useEffect, useState, use, Fragment, useRef, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, ExternalLink, Tag, Star, Users, BarChart3,
  AlertCircle, RefreshCw, ChevronRight
} from 'lucide-react';
import { parseBBCode } from '@/lib/bbcode';
import { Pagination, PaginationSkeleton } from '@/components/browse/Pagination';
import {
  vndbStatsApi,
  TagDetail,
  TagVN,
  TagStatsData,
  SimilarTag,
  SimilarTrait,
  TagParent,
  TagChild,
} from '@/lib/vndb-stats-api';

// Human-readable category labels
const categoryLabels: Record<string, string> = {
  cont: 'Content',
  ero: 'Sexual Content',
  tech: 'Technical',
};
import { StatsSummaryCard } from '@/components/stats/StatsSummaryCard';
import { ScoreDistributionChart } from '@/components/stats/ScoreDistributionChart';
import { ReleaseYearChart } from '@/components/stats/ReleaseYearChart';
import { LengthChart } from '@/components/stats/LengthChart';
import { AgeRatingChart } from '@/components/stats/AgeRatingChart';
import { TagDetailTabs, TagTabId } from '@/components/stats/TagDetailTabs';
import { LoadingScreen } from '@/components/LoadingScreen';
import { consumePendingScroll } from '@/components/ScrollToTop';

const VALID_TABS: TagTabId[] = ['summary', 'novels', 'similar-tags', 'similar-traits'];
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { LanguageFilter, LanguageFilterValue } from '@/components/stats/LanguageFilter';
import { SpoilerFilter, SpoilerFilterValue } from '@/components/stats/SpoilerFilter';
import { sortTagsByWeight } from '@/lib/weighted-score-utils';
import { LastUpdated } from '@/components/stats/LastUpdated';
import { NSFWImage } from '@/components/NSFWImage';
import { useImageFade } from '@/hooks/useImageFade';

/** Preload VN cover images into browser cache using Image() objects */
function preloadVNImages(vns: Array<{ image_url?: string | null; id: string }>) {
  vns.forEach(vn => {
    if (vn.image_url) {
      const img = new Image();
      const url = getProxiedImageUrl(vn.image_url, { width: 128, vnId: vn.id });
      if (url) img.src = url;
    }
  });
}

interface PageProps {
  params: Promise<{ tagId: string }>;
}

export default function TagDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const tagId = resolvedParams.tagId;

  // URL-based tab + page state
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabFromUrl = searchParams.get('tab') as TagTabId | null;
  const pageFromUrl = searchParams.get('page');
  const initialPage = pageFromUrl ? Math.max(1, parseInt(pageFromUrl, 10) || 1) : 1;

  const [tag, setTag] = useState<TagDetail | null>(null);
  const [stats, setStats] = useState<TagStatsData | null>(null);
  const [vns, setVns] = useState<TagVN[]>([]);
  const [similarTags, setSimilarTags] = useState<SimilarTag[]>([]);
  const [traits, setTraits] = useState<SimilarTrait[]>([]);
  const [parents, setParents] = useState<TagParent[]>([]);
  const [children, setChildren] = useState<TagChild[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingTab, setIsLoadingTab] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshBlockedUntil, setRefreshBlockedUntil] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TagTabId>(
    tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'summary'
  );
  const [usingFallback, setUsingFallback] = useState(false);
  const [languageFilter, setLanguageFilter] = useState<LanguageFilterValue>('ja');
  const [spoilerFilter, setSpoilerFilter] = useState<SpoilerFilterValue>(0);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(1);
  const [totalVns, setTotalVns] = useState(0);

  const updateUrl = useCallback((tab: TagTabId, page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'summary') params.delete('tab');
    else params.set('tab', tab);
    if (page <= 1) params.delete('page');
    else params.set('page', String(page));
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [pathname, router, searchParams]);

  // Ref for caching previous data during pagination (smooth loading overlay)
  const previousVnsRef = useRef<TagVN[]>([]);
  // Ref for prefetched pages cache
  const prefetchCacheRef = useRef<Map<string, { vns: TagVN[]; page: number; pages: number; total: number }>>(new Map());
  // Ref for scroll target
  const resultsRef = useRef<HTMLDivElement>(null);
  // Track whether we've attempted to load novels (to avoid flashing "no results" before load starts)
  const hasAttemptedVnsRef = useRef(false);
  // Track whether this is the initial mount after a back navigation (for scroll restoration)
  const isInitialBackNavRef = useRef(false);

  // Detect back navigation on mount for scroll restoration
  useEffect(() => {
    const isBackNav = sessionStorage.getItem('is-popstate-navigation') === 'true';
    sessionStorage.removeItem('is-popstate-navigation');
    if (isBackNav) {
      isInitialBackNavRef.current = true;
    }
  }, []);

  // Handle tab change - update URL and reset page
  const handleTabChange = useCallback((newTab: TagTabId) => {
    setActiveTab(newTab);
    setCurrentPage(1);
    setVns([]);
    hasAttemptedVnsRef.current = false;
    prefetchCacheRef.current.clear();
    updateUrl(newTab, 1);
  }, [updateUrl]);

  // Handle page change - update URL
  const handlePageChange = useCallback((newPage: number) => {
    loadNovels(newPage);
    updateUrl(activeTab, newPage);
  }, [activeTab, updateUrl]);

  // Sync URL -> state for back/forward navigation
  useEffect(() => {
    const urlTab = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'summary';
    const urlPage = pageFromUrl ? Math.max(1, parseInt(pageFromUrl, 10) || 1) : 1;
    const tabChanged = urlTab !== activeTab;

    if (tabChanged) {
      setActiveTab(urlTab);
      setCurrentPage(urlPage);
      setVns([]);
      hasAttemptedVnsRef.current = false;
      prefetchCacheRef.current.clear();
    } else if (urlPage !== currentPage && urlTab === 'novels' && vns.length > 0) {
      setCurrentPage(urlPage);
      loadNovels(urlPage);
    }
  }, [tabFromUrl, pageFromUrl]);

  useEffect(() => {
    loadInitialData();
  }, [tagId]);

  // Set page title
  useEffect(() => {
    if (tag) {
      document.title = `${tag.name} - Tag Stats | VN Club`;
    }
  }, [tag]);

  const handleRefresh = async () => {
    const now = Date.now();
    if (now < refreshBlockedUntil || isRefreshing) return;
    setIsRefreshing(true);
    setRefreshBlockedUntil(now + 8000); // 8s cooldown
    await loadInitialData(true);
    setIsRefreshing(false);
  };

  // Lazy load tab data
  useEffect(() => {
    if (activeTab === 'novels' && vns.length === 0 && !isLoadingTab) {
      loadNovels(currentPage);
    } else if (activeTab === 'similar-tags' && similarTags.length === 0 && !isLoadingTab) {
      loadSimilarTags();
    } else if (activeTab === 'similar-traits' && traits.length === 0 && !isLoadingTab) {
      loadTraits();
    }
  }, [activeTab, vns.length]);

  const loadInitialData = async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);

    try {
      // Check if we're using fallback mode (direct VNDB API instead of backend)
      const fallbackMode = await vndbStatsApi.isUsingFallback();
      setUsingFallback(fallbackMode);

      // Load tag info, stats, hierarchy, and counts for tab badges in parallel
      const [tagData, statsData, similarTagsData, traitsData, parentsData, childrenData] = await Promise.all([
        vndbStatsApi.getTag(tagId),
        vndbStatsApi.getTagStats(tagId, { nocache: forceRefresh }),
        vndbStatsApi.getSimilarTags(tagId, 30),
        vndbStatsApi.getTagTraits(tagId, 30),
        vndbStatsApi.getTagParents(tagId),
        vndbStatsApi.getTagChildren(tagId),
      ]);

      if (!tagData) {
        setError('Tag not found.');
        return;
      }

      setTag(tagData);
      setStats(statsData);
      setSimilarTags(similarTagsData);
      setTraits(traitsData);
      setParents(parentsData);
      setChildren(childrenData);
    } catch {
      setError('Failed to load tag data.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadNovels = async (page: number = 1, spoilerLevel: number = spoilerFilter, olang: string = languageFilter) => {
    hasAttemptedVnsRef.current = true;
    const cacheKey = `${page}-${spoilerLevel}-${olang}`;

    // Check prefetch cache first
    if (prefetchCacheRef.current.has(cacheKey)) {
      const cached = prefetchCacheRef.current.get(cacheKey)!;
      prefetchCacheRef.current.delete(cacheKey);
      setVns(cached.vns);
      previousVnsRef.current = cached.vns;
      setCurrentPage(cached.page);
      setTotalPages(cached.pages);
      setTotalVns(cached.total);

      // Prefetch next page
      if (cached.page < cached.pages) {
        const nextKey = `${cached.page + 1}-${spoilerLevel}-${olang}`;
        if (!prefetchCacheRef.current.has(nextKey)) {
          vndbStatsApi.getTagVNs(tagId, cached.page + 1, 24, 'rating', spoilerLevel, olang === 'all' ? undefined : olang)
            .then(result => {
              if (result) {
                prefetchCacheRef.current.set(nextKey, result);
                preloadVNImages(result.vns);
              }
            })
            .catch(() => {});
        }
      }
      if (isInitialBackNavRef.current) {
        isInitialBackNavRef.current = false;
        consumePendingScroll();
      }
      return;
    }

    setIsLoadingTab(true);
    try {
      const response = await vndbStatsApi.getTagVNs(tagId, page, 24, 'rating', spoilerLevel, olang === 'all' ? undefined : olang);
      if (response) {
        setVns(response.vns);
        previousVnsRef.current = response.vns; // Cache for smooth loading overlay
        setCurrentPage(response.page);
        setTotalPages(response.pages);
        setTotalVns(response.total);

        // Prefetch next page
        if (response.page < response.pages) {
          const nextKey = `${response.page + 1}-${spoilerLevel}-${olang}`;
          if (!prefetchCacheRef.current.has(nextKey)) {
            vndbStatsApi.getTagVNs(tagId, response.page + 1, 24, 'rating', spoilerLevel, olang === 'all' ? undefined : olang)
              .then(result => {
                if (result) {
                  prefetchCacheRef.current.set(nextKey, result);
                  preloadVNImages(result.vns);
                }
              })
              .catch(() => {});
          }
        }
      }
    } catch {
      // Novels are optional, silently fail
    } finally {
      setIsLoadingTab(false);
      if (isInitialBackNavRef.current) {
        isInitialBackNavRef.current = false;
        consumePendingScroll();
      }
    }
  };

  const handleSpoilerChange = useCallback((value: SpoilerFilterValue) => {
    prefetchCacheRef.current.clear();
    setSpoilerFilter(value);
    setCurrentPage(1);
    loadNovels(1, value);
    updateUrl(activeTab, 1);
  }, [activeTab, updateUrl]);

  const handleLanguageChange = useCallback((value: LanguageFilterValue) => {
    prefetchCacheRef.current.clear();
    setLanguageFilter(value);
    setCurrentPage(1);
    loadNovels(1, spoilerFilter, value);
    updateUrl(activeTab, 1);
  }, [activeTab, spoilerFilter, updateUrl]);

  const loadSimilarTags = async () => {
    setIsLoadingTab(true);
    try {
      const data = await vndbStatsApi.getSimilarTags(tagId, 30);
      setSimilarTags(data);
    } catch {
      // Similar tags are optional, silently fail
    } finally {
      setIsLoadingTab(false);
      if (isInitialBackNavRef.current) {
        isInitialBackNavRef.current = false;
        consumePendingScroll();
      }
    }
  };

  const loadTraits = async () => {
    setIsLoadingTab(true);
    try {
      const data = await vndbStatsApi.getTagTraits(tagId, 30);
      setTraits(data);
    } catch {
      // Traits are optional, silently fail
    } finally {
      setIsLoadingTab(false);
      if (isInitialBackNavRef.current) {
        isInitialBackNavRef.current = false;
        consumePendingScroll();
      }
    }
  };

  if (isLoading) {
    return <LoadingScreen title="Loading tag stats..." subtitle="Crunching VNDB data for this tag" />;
  }

  if (error || !tag) {
    return <ErrorState error={error} tagId={tagId} />;
  }

  return (
    <div className="relative max-w-7xl mx-auto px-4 py-8 overflow-x-hidden">
      {isRefreshing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-gray-800 shadow border border-gray-200 dark:border-gray-700">
            <RefreshCw className="w-4 h-4 animate-spin text-primary-500" />
            <span className="text-sm text-gray-700 dark:text-gray-200">Refreshing…</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div className="flex items-start gap-4">
          <button
            onClick={() => window.history.back()}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors mt-1"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <div>
            {/* Breadcrumb */}
            {parents.length > 0 && (
              <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mb-2 flex-wrap">
                <Link href="/browse?tab=tags" className="hover:text-primary-600 dark:hover:text-primary-400">Tags</Link>
                {parents.map((p) => (
                  <Fragment key={p.id}>
                    <ChevronRight className="w-3 h-3 flex-shrink-0" />
                    <Link
                      href={`/stats/tag/${p.id}`}
                      className="hover:text-primary-600 dark:hover:text-primary-400"
                    >
                      {p.name}
                    </Link>
                  </Fragment>
                ))}
                <ChevronRight className="w-3 h-3 flex-shrink-0" />
                <span className="text-gray-700 dark:text-gray-300">{tag.name}</span>
              </div>
            )}
            <div className="flex items-center gap-2 mb-1">
              <Tag className="w-5 h-5 text-primary-500" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {tag.name}
              </h1>
              {tag.category && (
                <span className="px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                  {categoryLabels[tag.category] || tag.category}
                </span>
              )}
            </div>
            <a
              href={`https://vndb.org/${tag.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center gap-1"
            >
              View on VNDB <ExternalLink className="w-3 h-3" />
            </a>
            {tag.description && (
              <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 max-w-2xl break-words">
                <p>
                  {parseBBCode(
                    !showFullDescription && tag.description.length > 300
                      ? tag.description.substring(0, 300) + '...'
                      : tag.description
                  )}
                </p>
                {tag.description.length > 300 && (
                  <button
                    onClick={() => setShowFullDescription(!showFullDescription)}
                    className="mt-1 text-primary-600 dark:text-primary-400 hover:underline text-sm"
                  >
                    {showFullDescription ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        {/* Only show refresh for tags with VNs */}
        {(tag.vn_count ?? 0) > 0 && (
          <div className="flex flex-col items-end gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || Date.now() < refreshBlockedUntil}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing…' : 'Refresh data'}
            </button>
            <LastUpdated timestamp={stats?.last_updated} />
          </div>
        )}
      </div>

      {/* Fallback Mode Warning - only for tags with actual VNs */}
      {usingFallback && (tag.vn_count ?? 0) > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                Limited Data Mode
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                Showing partial data. Statistics may be less accurate than usual. Please try again later for full results.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs - hide some tabs for meta-tags with 0 direct VNs */}
      <TagDetailTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        counts={{
          novels: tag.vn_count ?? 0,
        }}
        hideTabs={(tag.vn_count ?? 0) === 0 ? ['novels', 'similar-tags', 'similar-traits'] : []}
      />

      {/* Summary Tab */}
      {activeTab === 'summary' && (
        <>
          {/* Child Tags */}
          {children.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none mb-8">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                Child Tags ({children.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {children.map(child => (
                  <Link
                    key={child.id}
                    href={`/stats/tag/${child.id}`}
                    className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm hover:bg-primary-100 dark:hover:bg-primary-900/30 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                  >
                    {child.name}
                    {child.vn_count != null && (
                      <span className="text-gray-400 dark:text-gray-500 ml-1.5">
                        ({child.vn_count.toLocaleString()})
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Meta-tag notice when no direct VNs */}
          {(tag.vn_count ?? 0) === 0 && children.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-6 border border-gray-100 dark:border-gray-700 text-center">
              <p className="text-gray-500 dark:text-gray-400">
                This is a meta-tag used for categorization. Browse the child tags above to find visual novels.
              </p>
            </div>
          )}

          {/* Only show stats and charts for tags with direct VNs */}
          {stats && (tag.vn_count ?? 0) > 0 && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
                <StatsSummaryCard
                  icon={<Star className="w-5 h-5" />}
                  label="Average Rating"
                  value={stats.average_rating > 0 ? stats.average_rating.toFixed(2) : 'N/A'}
                  subtext={`from ${stats.total_users.toLocaleString()} rated VNs`}
                />
                <StatsSummaryCard
                  icon={<BarChart3 className="w-5 h-5" />}
                  label="Total Votes"
                  value={stats.total_votes.toLocaleString()}
                  subtext="cumulative votes on all VNs"
                />
                <StatsSummaryCard
                  icon={<Users className="w-5 h-5" />}
                  label="VNs with Tag"
                  value={tag.vn_count?.toLocaleString() || 'N/A'}
                  subtext="visual novels"
                />
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <ScoreDistributionChart
                  distribution={stats.score_distribution}
                  jpDistribution={stats.score_distribution_jp}
                  average={stats.average_rating}
                  entityId={tagId}
                  entityType="tag"
                />
                <ReleaseYearChart
                  distribution={stats.release_year_distribution}
                  distributionWithRatings={stats.release_year_with_ratings}
                  entityId={tagId}
                  entityType="tag"
                />
                <LengthChart
                  distribution={stats.length_distribution}
                  entityId={tagId}
                  entityType="tag"
                />
                {Object.keys(stats.age_rating_distribution).length > 0 && (
                  <AgeRatingChart
                    distribution={stats.age_rating_distribution}
                    entityId={tagId}
                    entityType="tag"
                  />
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Novels Tab */}
      {activeTab === 'novels' && (
        <div ref={resultsRef} className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {totalVns > 0 && `${totalVns.toLocaleString()} visual novels`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <SpoilerFilter value={spoilerFilter} onChange={handleSpoilerChange} />
              <LanguageFilter value={languageFilter} onChange={handleLanguageChange} />
            </div>
          </div>

          {/* Initial load: show skeleton grid with pagination skeleton */}
          {(isLoadingTab || !hasAttemptedVnsRef.current) && vns.length === 0 && previousVnsRef.current.length === 0 ? (
            <>
              <PaginationSkeleton />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <VNCardSkeleton key={i} />
                ))}
              </div>
              <PaginationSkeleton />
            </>
          ) : (
            /* Content with loading overlay - keeps previous content visible during pagination */
            <div>
              {/* Content - show current or cached data */}
              {(vns.length > 0 || previousVnsRef.current.length > 0) ? (
                <div className={`transition-opacity duration-150 ${isLoadingTab ? 'opacity-60 pointer-events-none' : ''}`}>
                  {totalPages > 1 && (
                    <Pagination
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={handlePageChange}
                      totalItems={totalVns}
                      itemsPerPage={24}
                    />
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(vns.length > 0 ? vns : previousVnsRef.current).map((vn) => (
                      <VNCard key={vn.id} vn={vn} />
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <Pagination
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={handlePageChange}
                      totalItems={totalVns}
                      itemsPerPage={24}
                      scrollTargetRef={resultsRef}
                    />
                  )}
                </div>
              ) : hasAttemptedVnsRef.current && (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No visual novels found with this tag{languageFilter === 'ja' ? ' (Japanese only)' : ''}.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Similar Tags Tab */}
      {activeTab === 'similar-tags' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          {isLoadingTab ? (
            <LoadingTabContent message="Loading similar tags..." />
          ) : similarTags.length > 0 ? (
            <div className="space-y-3">
              {similarTags.map((simTag) => (
                <SimilarTagRow key={simTag.id} tag={simTag} />
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">
              No similar tags found.
            </p>
          )}
        </div>
      )}

      {/* Similar Traits Tab */}
      {activeTab === 'similar-traits' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          {isLoadingTab ? (
            <LoadingTabContent message="Loading character traits..." />
          ) : traits.length > 0 ? (
            <div className="space-y-3">
              {traits.map((trait) => (
                <TraitRow key={trait.id} trait={trait} />
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">
              No character traits data available.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function VNCard({ vn }: { vn: TagVN }) {
  const { preference } = useTitlePreference();
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  const displayTitle = getDisplayTitle({ title: vn.title, title_jp: vn.title_jp || vn.alttitle, title_romaji: vn.title_romaji }, preference);

  return (
    <Link
      href={`/vn/${vn.id}`}
      className="flex gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 shadow-sm hover:shadow-md hover:shadow-gray-200/40 dark:hover:shadow-none transition-all duration-200"
    >
      <div className="w-16 h-20 flex-shrink-0 relative overflow-hidden rounded">
        <div className={shimmerClass} />
        {vn.image_url ? (
          <NSFWImage
            src={getProxiedImageUrl(vn.image_url, { width: 128, vnId: vn.id })}
            alt={displayTitle}
            vnId={vn.id}
            imageSexual={vn.image_sexual}
            className={`w-full h-full object-cover ${fadeClass}`}
            onLoad={onLoad}
          />
        ) : (
          <div className="absolute inset-0 bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
            <Tag className="w-6 h-6 text-gray-400" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-gray-900 dark:text-white text-sm truncate">
          {displayTitle}
        </h4>
        {vn.released && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {vn.released.substring(0, 4)}
          </p>
        )}
        {vn.rating && (
          <div className="flex items-center gap-1 mt-1">
            <Star className="w-3 h-3 text-yellow-500" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {vn.rating.toFixed(2)}
            </span>
            {vn.votecount && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                ({vn.votecount.toLocaleString()})
              </span>
            )}
          </div>
        )}
        {vn.tags && vn.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {sortTagsByWeight(vn.tags).slice(0, 3).map((t) => (
              <span
                key={t.id}
                className="px-1.5 py-0.5 text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded"
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

function SimilarTagRow({ tag }: { tag: SimilarTag }) {
  const percentage = Math.round(tag.similarity * 100);

  return (
    <Link
      href={`/stats/tag/${tag.id}`}
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Tag className="w-4 h-4 text-primary-500 flex-shrink-0" />
        <span className="font-medium text-gray-900 dark:text-white truncate">{tag.name}</span>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-4">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {tag.shared_vn_count} shared VNs
        </span>
        <div className="w-24 flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-10 text-right">
            {percentage}%
          </span>
        </div>
      </div>
    </Link>
  );
}

function TraitRow({ trait }: { trait: SimilarTrait }) {
  const percentage = Math.round(trait.frequency * 100);

  return (
    <Link
      href={`/stats/trait/${trait.id}`}
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Users className="w-4 h-4 text-purple-500 flex-shrink-0" />
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-gray-900 dark:text-white truncate">{trait.name}</span>
          {trait.group_name && (
            <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 flex-shrink-0">
              {trait.group_name}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-4">
        <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {trait.character_count} characters
        </span>
        <div className="w-24 flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full"
              style={{ width: `${Math.min(100, percentage)}%` }}
            />
          </div>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-10 text-right">
            {percentage}%
          </span>
        </div>
      </div>
    </Link>
  );
}

function LoadingTabContent({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw className="w-6 h-6 animate-spin text-primary-500" />
      <span className="ml-2 text-gray-500 dark:text-gray-400">{message}</span>
    </div>
  );
}

function ErrorState({ error, tagId }: { error: string | null; tagId: string }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
        <AlertCircle className="w-8 h-8 text-red-500" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Unable to Load Tag
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {error || 'Something went wrong while loading the tag data.'}
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Go Back
        </button>
        <a
          href={`https://vndb.org/g${tagId.replace(/\D/g, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Check on VNDB
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}

function VNCardSkeleton() {
  return (
    <div className="flex gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
      {/* Image placeholder */}
      <div className="w-16 h-20 flex-shrink-0 rounded image-placeholder" />
      <div className="flex-1 min-w-0 space-y-2">
        {/* Title */}
        <div className="h-4 w-4/5 rounded image-placeholder" />
        {/* Year */}
        <div className="h-3 w-12 rounded image-placeholder" />
        {/* Rating */}
        <div className="h-3 w-20 rounded image-placeholder" />
        {/* Tags */}
        <div className="flex gap-1 mt-2">
          <div className="h-4 w-14 rounded image-placeholder" />
          <div className="h-4 w-12 rounded image-placeholder" />
          <div className="h-4 w-16 rounded image-placeholder" />
        </div>
      </div>
    </div>
  );
}
