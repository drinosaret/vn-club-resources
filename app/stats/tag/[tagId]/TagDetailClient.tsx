'use client';

import { useEffect, useState, use, Fragment, useRef, useCallback } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import Link from '@/components/Link';
import { ArrowLeft, ExternalLink, Tag, RefreshCw, ChevronRight } from 'lucide-react';
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
import { useImageRetry } from '@/hooks/useImageRetry';
import { preloadVNImages, addRetryKey } from '@/lib/preload-images';
import { ADULT_SCENE_TAG_CATEGORIES } from '@/app/stats/rankings/build/slice-options';

interface PageProps {
  params: Promise<{ tagId: string }>;
}

export default function TagDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const tagId = resolvedParams.tagId;

  // URL-based tab + page state
  const searchParams = useSearchParams();
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
    const params = new URLSearchParams();
    if (tab !== 'summary') params.set('tab', tab);
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    const newUrl = qs ? `${pathname}?${qs}` : pathname;
    window.history.replaceState(window.history.state, '', newUrl);
  }, [pathname]);

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
    loadNovels(newPage, spoilerFilter, languageFilter);
    updateUrl(activeTab, newPage);
  }, [activeTab, spoilerFilter, languageFilter, updateUrl]);

  // Prefetch page on hover: preload images from cached response or trigger API fetch
  const handlePrefetchPage = useCallback((page: number) => {
    const cacheKey = `${page}-${spoilerFilter}-${languageFilter}`;
    if (prefetchCacheRef.current.has(cacheKey)) {
      preloadVNImages(prefetchCacheRef.current.get(cacheKey)!.vns);
      return;
    }
    vndbStatsApi.getTagVNs(tagId, page, 24, 'rating', spoilerFilter, languageFilter === 'all' ? undefined : languageFilter)
      .then(result => {
        if (result) {
          prefetchCacheRef.current.set(cacheKey, result);
          preloadVNImages(result.vns);
        }
      })
      .catch(() => {});
  }, [tagId, spoilerFilter, languageFilter]);

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
    loadNovels(1, value, languageFilter);
    updateUrl(activeTab, 1);
  }, [activeTab, languageFilter, updateUrl]);

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
    <div className="relative max-w-7xl mx-auto px-4 py-8 overflow-x-clip">
      {isRefreshing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[color:var(--surface)] backdrop-blur-xs">
          <div className="flex items-center gap-2 px-4 py-2 rounded-xs bg-[color:var(--surface)] border border-[color:var(--rule)]">
            <RefreshCw className="w-4 h-4 animate-spin text-[color:var(--ai)]" />
            <span className="text-sm text-[color:var(--text-secondary)]">Refreshing…</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div className="flex items-start gap-4">
          <button
            onClick={() => window.history.back()}
            aria-label="Go back"
            className="st-act st-act--icon mt-1"
          >
            <ArrowLeft className="w-5 h-5 text-[color:var(--nezu)]" />
          </button>
          <div>
            {/* Breadcrumb */}
            {parents.length > 0 && (
              <div className="flex items-center gap-1 text-sm text-[color:var(--nezu)] mb-2 flex-wrap">
                <Link href="/browse?tab=tags" className="hover:text-[color:var(--ai)]">Tags</Link>
                {parents.map((p) => (
                  <Fragment key={p.id}>
                    <ChevronRight className="w-3 h-3 shrink-0" />
                    <Link
                      href={`/stats/tag/${p.id}`}
                      className="hover:text-[color:var(--ai)]"
                    >
                      {p.name}
                    </Link>
                  </Fragment>
                ))}
                <ChevronRight className="w-3 h-3 shrink-0" />
                <span className="text-[color:var(--text-secondary)]">{tag.name}</span>
              </div>
            )}
            <div className="flex items-center gap-2 mb-1">
              <h1 className="sec-title">
                {tag.name}
              </h1>
              {tag.category && (
                <span className="st-badge">
                  {categoryLabels[tag.category] || tag.category}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <a
                href={`https://vndb.org/${tag.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="sec-more"
              >
                View on VNDB <span aria-hidden>&rarr;</span>
              </a>
              {/* Anyone reading a tag's page is the person most likely to want its readers
                  ranked, and the ranking is reachable from nowhere else nearby. The id is
                  carried in VNDB's prefixed form here and bare in the ranking's URL. A tag
                  describing an adult scene cannot narrow a ranking of readers: the builder
                  refuses to offer it and the backend refuses to answer it, so the link is
                  left off rather than pointing at a page that says no. */}
              {!ADULT_SCENE_TAG_CATEGORIES.includes(tag.category ?? '') && (
                <Link
                  href={`/stats/rankings/build/?subject=readers&question=read-most&tag=${tag.id.replace(/^g/, '')}&name=${encodeURIComponent(tag.name)}`}
                  className="sec-more"
                >
                  See who reads it
                  <span aria-hidden>&rarr;</span>
                </Link>
              )}
            </div>
            {tag.description && (
              <div className="mt-3 text-sm text-[color:var(--nezu)] max-w-2xl wrap-break-word">
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
                    className="sec-more mt-1"
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
              className="st-act disabled:cursor-not-allowed"
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
        <div className="st-note st-note--mild mb-6 p-4">
          <p className="fig-label">Limited Data Mode</p>
          <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
            Showing partial data. Statistics may be less accurate than usual. Please try again later for full results.
          </p>
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
            <div className="st-card p-4 mb-8">
              <h2 className="fig-label mb-3">
                Child Tags ({children.length})
              </h2>
              <div className="flex flex-wrap gap-2">
                {children.map(child => (
                  <Link
                    key={child.id}
                    href={`/stats/tag/${child.id}`}
                    className="st-chip"
                  >
                    {child.name}
                    {child.vn_count != null && (
                      <span className="text-[color:var(--text-faint)] ml-1.5">
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
            <div className="st-card p-6 text-center">
              <p className="text-[color:var(--nezu)]">
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
                  label="Average Rating"
                  value={stats.average_rating > 0 ? stats.average_rating.toFixed(2) : 'N/A'}
                  subtext={`from ${stats.total_users.toLocaleString()} rated VNs`}
                />
                <StatsSummaryCard
                  label="Total Votes"
                  value={stats.total_votes.toLocaleString()}
                  subtext="cumulative votes on all VNs"
                />
                <StatsSummaryCard
                  label="VNs with Tag"
                  value={tag.vn_count?.toLocaleString() || 'N/A'}
                  subtext="visual novels"
                />
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <ScoreDistributionChart headingLevel="h2"
                  distribution={stats.score_distribution}
                  jpDistribution={stats.score_distribution_jp}
                  average={stats.average_rating}
                  entityId={tagId}
                  entityType="tag"
                />
                <ReleaseYearChart headingLevel="h2"
                  distribution={stats.release_year_distribution}
                  distributionWithRatings={stats.release_year_with_ratings}
                  entityId={tagId}
                  entityType="tag"
                />
                <LengthChart headingLevel="h2"
                  distribution={stats.length_distribution}
                  entityId={tagId}
                  entityType="tag"
                />
                {Object.keys(stats.age_rating_distribution).length > 0 && (
                  <AgeRatingChart headingLevel="h2"
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
        <div ref={resultsRef} className="st-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <p className="text-sm text-[color:var(--nezu)]">
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
                <div className={isLoadingTab ? 'pointer-events-none' : ''}>
                  {totalPages > 1 && (
                    <Pagination
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={handlePageChange}
                      onPrefetchPage={handlePrefetchPage}
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
                      onPrefetchPage={handlePrefetchPage}
                      totalItems={totalVns}
                      itemsPerPage={24}
                      scrollTargetRef={resultsRef}
                    />
                  )}
                </div>
              ) : hasAttemptedVnsRef.current && (
                <p className="st-card-sub py-8 text-center">
                  No visual novels found with this tag{languageFilter === 'ja' ? ' (Japanese only)' : ''}.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Similar Tags Tab */}
      {activeTab === 'similar-tags' && (
        <div className="st-card p-6">
          {isLoadingTab ? (
            <LoadingTabContent message="Loading similar tags..." />
          ) : similarTags.length > 0 ? (
            <div className="space-y-3">
              {similarTags.map((simTag) => (
                <SimilarTagRow key={simTag.id} tag={simTag} />
              ))}
            </div>
          ) : (
            <p className="st-card-sub py-8 text-center">
              No similar tags found.
            </p>
          )}
        </div>
      )}

      {/* Similar Traits Tab */}
      {activeTab === 'similar-traits' && (
        <div className="st-card p-6">
          {isLoadingTab ? (
            <LoadingTabContent message="Loading character traits..." />
          ) : traits.length > 0 ? (
            <div className="space-y-3">
              {traits.map((trait) => (
                <TraitRow key={trait.id} trait={trait} />
              ))}
            </div>
          ) : (
            <p className="st-card-sub py-8 text-center">
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
  const { loaded, error, retryKey, onLoad, onError } = useImageRetry();
  const displayTitle = getDisplayTitle({ title: vn.title, title_jp: vn.title_jp || vn.alttitle, title_romaji: vn.title_romaji }, preference);
  const showImage = vn.image_url && !error;

  return (
    <Link
      href={`/vn/${vn.id}`}
      className="st-card st-card--pick flex gap-3 p-3"
    >
      <div className="w-16 h-20 shrink-0 relative overflow-hidden rounded-xs">
        {showImage && !loaded && <div className="absolute inset-0 image-placeholder" />}
        {showImage ? (
          <NSFWImage
            src={addRetryKey(getProxiedImageUrl(vn.image_url!, { width: 128, vnId: vn.id }) || '', retryKey)}
            alt={displayTitle}
            vnId={vn.id}
            imageSexual={vn.image_sexual}
            className={`w-full h-full object-cover ${loaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={onLoad}
            onError={onError}
            compact
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--surface-inset)]">
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="dg-name block">
          {displayTitle}
        </h4>
        {vn.released && (
          <p className="text-xs text-[color:var(--nezu)] mt-0.5">
            {vn.released.substring(0, 4)}
          </p>
        )}
        {vn.rating && (
          <div className="flex items-center gap-1 mt-1">
            <span className="text-xs font-medium text-[color:var(--text-secondary)]">
              {vn.rating.toFixed(2)}
            </span>
            {vn.votecount && (
              <span className="text-xs text-[color:var(--nezu)]">
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
                className="st-badge"
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
      className="st-row flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="dg-name">{tag.name}</span>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-4">
        <span className="st-num text-xs text-[color:var(--text-faint)]">
          {tag.shared_vn_count} shared VNs
        </span>
        <div className="w-24 flex items-center gap-2">
          <div className="st-bar h-2 flex-1">
            <div
              className="st-bar-fill"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="st-num w-10 text-right text-xs text-[color:var(--ink)]">
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
      className="st-row flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="dg-name">{trait.name}</span>
          {trait.group_name && (
            <span className="st-badge shrink-0">
              {trait.group_name}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-4">
        <span className="text-sm text-[color:var(--nezu)] whitespace-nowrap">
          {trait.character_count} characters
        </span>
        <div className="w-24 flex items-center gap-2">
          <div className="st-bar h-2 flex-1">
            <div
              className="st-bar-fill"
              style={{ width: `${Math.min(100, percentage)}%` }}
            />
          </div>
          <span className="st-num w-10 text-right text-xs text-[color:var(--ink)]">
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
      <RefreshCw className="w-6 h-6 animate-spin text-[color:var(--ai)]" />
      <span className="ml-2 text-[color:var(--nezu)]">{message}</span>
    </div>
  );
}

function ErrorState({ error, tagId }: { error: string | null; tagId: string }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <h1 className="sec-title mb-2">
        Unable to Load Tag
      </h1>
      <p className="text-[color:var(--nezu)] mb-6">
        {error || 'Something went wrong while loading the tag data.'}
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          onClick={() => window.history.back()}
          className="st-act st-act--go"
        >
          <ArrowLeft className="w-4 h-4" />
          Go Back
        </button>
        <a
          href={`https://vndb.org/g${tagId.replace(/\D/g, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="st-act"
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
    <div className="st-card flex gap-3 p-3">
      {/* Image placeholder */}
      <div className="w-16 h-20 shrink-0 rounded-xs image-placeholder" />
      <div className="flex-1 min-w-0 space-y-2">
        {/* Title */}
        <div className="h-4 w-4/5 rounded-xs image-placeholder" />
        {/* Year */}
        <div className="h-3 w-12 rounded-xs image-placeholder" />
        {/* Rating */}
        <div className="h-3 w-20 rounded-xs image-placeholder" />
        {/* Tags */}
        <div className="flex gap-1 mt-2">
          <div className="h-4 w-14 rounded-xs image-placeholder" />
          <div className="h-4 w-12 rounded-xs image-placeholder" />
          <div className="h-4 w-16 rounded-xs image-placeholder" />
        </div>
      </div>
    </div>
  );
}
