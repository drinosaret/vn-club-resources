'use client';

import { useEffect, useState, useRef, use, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';
import {
  ArrowLeft, ExternalLink, Building2, Star, Users, BarChart3,
  AlertCircle, RefreshCw, BookOpen, ChevronRight
} from 'lucide-react';
import {
  vndbStatsApi,
  ProducerStatsData,
  TagVN,
  SimilarProducerResult,
} from '@/lib/vndb-stats-api';
import { StatsSummaryCard } from '@/components/stats/StatsSummaryCard';
import { ScoreDistributionChart } from '@/components/stats/ScoreDistributionChart';
import { ReleaseYearChart } from '@/components/stats/ReleaseYearChart';
import { LengthChart } from '@/components/stats/LengthChart';
import { AgeRatingChart } from '@/components/stats/AgeRatingChart';
import { LoadingScreen } from '@/components/LoadingScreen';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { useTitlePreference, getDisplayTitle, getEntityDisplayName } from '@/lib/title-preference';
import { LastUpdated } from '@/components/stats/LastUpdated';
import { LanguageFilter, LanguageFilterValue } from '@/components/stats/LanguageFilter';
import { SpoilerFilter, SpoilerFilterValue } from '@/components/stats/SpoilerFilter';
import { sortTagsByWeight } from '@/lib/weighted-score-utils';
import { parseBBCode } from '@/lib/bbcode';
import { Pagination, PaginationSkeleton } from '@/components/browse/Pagination';
import { NSFWImage } from '@/components/NSFWImage';
import { useImageRetry } from '@/hooks/useImageRetry';
import { preloadVNImages, addRetryKey } from '@/lib/preload-images';

// Human-readable type labels
const typeLabels: Record<string, string> = {
  co: 'Company',
  in: 'Individual',
  ng: 'Amateur Group',
};

type TabId = 'summary' | 'novels' | 'similar';
const VALID_TABS: TabId[] = ['summary', 'novels', 'similar'];

interface PageProps {
  params: Promise<{ producerId: string }>;
}

export default function ProducerDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const producerId = resolvedParams.producerId;

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const tabFromUrl = searchParams.get('tab') as TabId | null;
  const pageFromUrl = searchParams.get('page');
  const initialPage = pageFromUrl ? Math.max(1, parseInt(pageFromUrl, 10) || 1) : 1;

  const [stats, setStats] = useState<ProducerStatsData | null>(null);
  const [vns, setVns] = useState<TagVN[]>([]);
  const [vnsPage, setVnsPage] = useState(initialPage);
  const [vnsTotal, setVnsTotal] = useState(0);
  const [vnsPages, setVnsPages] = useState(1);
  const [similarProducers, setSimilarProducers] = useState<SimilarProducerResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingTab, setIsLoadingTab] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshBlockedUntil, setRefreshBlockedUntil] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(
    tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'summary'
  );
  const [languageFilter, setLanguageFilter] = useState<LanguageFilterValue>('ja');
  const [spoilerFilter, setSpoilerFilter] = useState<SpoilerFilterValue>(0);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const { preference } = useTitlePreference();

  const updateUrl = useCallback((tab: TabId, page: number) => {
    const params = new URLSearchParams();
    if (tab !== 'summary') params.set('tab', tab);
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    const newUrl = qs ? `${pathname}?${qs}` : pathname;
    window.history.replaceState(window.history.state, '', newUrl);
  }, [pathname]);

  // Cache previous VNs for smooth loading overlay
  const previousVnsRef = useRef<TagVN[]>([]);
  const prefetchCacheRef = useRef<Map<string, { vns: TagVN[]; page: number; pages: number; total: number }>>(new Map());
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (vns.length > 0) previousVnsRef.current = vns;
  }, [vns]);

  useEffect(() => {
    loadInitialData();
  }, [producerId]);

  const handleRefresh = async () => {
    const now = Date.now();
    if (now < refreshBlockedUntil || isRefreshing) return;
    setIsRefreshing(true);
    setRefreshBlockedUntil(now + 8000);
    await loadInitialData(true);
    setIsRefreshing(false);
  };

  // Sync URL -> state for back/forward navigation
  useEffect(() => {
    const urlTab = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'summary';
    const urlPage = pageFromUrl ? Math.max(1, parseInt(pageFromUrl, 10) || 1) : 1;
    const tabChanged = urlTab !== activeTab;

    if (tabChanged) {
      setActiveTab(urlTab);
      setVnsPage(urlPage);
      setVns([]);
      setSimilarProducers([]);
    } else if (urlPage !== vnsPage && urlTab === 'novels' && vns.length > 0) {
      setVnsPage(urlPage);
      loadNovels(urlPage);
    }
  }, [tabFromUrl, pageFromUrl]);

  // Lazy load tab data
  useEffect(() => {
    if (activeTab === 'novels' && vns.length === 0 && !isLoadingTab) {
      loadNovels(vnsPage);
    } else if (activeTab === 'similar' && similarProducers.length === 0 && !isLoadingTab) {
      loadSimilarProducers();
    }
  }, [activeTab, vns.length, similarProducers.length]);

  const loadInitialData = async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const statsData = await vndbStatsApi.getProducerStats(producerId, { nocache: forceRefresh });

      if (!statsData) {
        setError('Producer not found or backend unavailable.');
        return;
      }

      setStats(statsData);
    } catch {
      setError('Failed to load producer data.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadNovels = async (page = 1, spoilerLevel: number = spoilerFilter, olang: string = languageFilter) => {
    const cacheKey = `${page}-${spoilerLevel}-${olang}`;

    // Check prefetch cache first
    if (prefetchCacheRef.current.has(cacheKey)) {
      const cached = prefetchCacheRef.current.get(cacheKey)!;
      prefetchCacheRef.current.delete(cacheKey);
      setVns(cached.vns);
      previousVnsRef.current = cached.vns;
      setVnsPage(cached.page);
      setVnsTotal(cached.total);
      setVnsPages(cached.pages);

      // Prefetch next page
      if (cached.page < cached.pages) {
        const nextKey = `${cached.page + 1}-${spoilerLevel}-${olang}`;
        if (!prefetchCacheRef.current.has(nextKey)) {
          vndbStatsApi.getProducerVNsWithTags(producerId, cached.page + 1, 24, 'rating', spoilerLevel, olang === 'all' ? undefined : olang)
            .then(result => {
              if (result) {
                prefetchCacheRef.current.set(nextKey, result);
                preloadVNImages(result.vns);
              }
            })
            .catch(() => {});
        }
      }
      return;
    }

    setIsLoadingTab(true);
    try {
      const response = await vndbStatsApi.getProducerVNsWithTags(producerId, page, 24, 'rating', spoilerLevel, olang === 'all' ? undefined : olang);
      if (response) {
        setVns(response.vns);
        previousVnsRef.current = response.vns;
        setVnsPage(response.page);
        setVnsTotal(response.total);
        setVnsPages(response.pages);

        // Prefetch next page
        if (response.page < response.pages) {
          const nextKey = `${response.page + 1}-${spoilerLevel}-${olang}`;
          if (!prefetchCacheRef.current.has(nextKey)) {
            vndbStatsApi.getProducerVNsWithTags(producerId, response.page + 1, 24, 'rating', spoilerLevel, olang === 'all' ? undefined : olang)
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
    }
  };

  const loadSimilarProducers = async () => {
    setIsLoadingTab(true);
    try {
      const data = await vndbStatsApi.getSimilarProducers(producerId, 20);
      setSimilarProducers(data);
    } catch {
      // Similar producers are optional, silently fail
    } finally {
      setIsLoadingTab(false);
    }
  };

  const handleTabChange = useCallback((newTab: TabId) => {
    prefetchCacheRef.current.clear();
    setActiveTab(newTab);
    setVnsPage(1);
    setVns([]);
    setSimilarProducers([]);
    updateUrl(newTab, 1);
  }, [updateUrl]);

  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1 && newPage <= vnsPages) {
      loadNovels(newPage, spoilerFilter, languageFilter);
      updateUrl(activeTab, newPage);
    }
  }, [activeTab, vnsPages, spoilerFilter, languageFilter, updateUrl]);

  const handleSpoilerChange = useCallback((value: SpoilerFilterValue) => {
    prefetchCacheRef.current.clear();
    setSpoilerFilter(value);
    setVnsPage(1);
    loadNovels(1, value, languageFilter);
    updateUrl(activeTab, 1);
  }, [activeTab, languageFilter, updateUrl]);

  const handleLanguageChange = useCallback((value: LanguageFilterValue) => {
    prefetchCacheRef.current.clear();
    setLanguageFilter(value);
    setVnsPage(1);
    loadNovels(1, spoilerFilter, value);
    updateUrl(activeTab, 1);
  }, [activeTab, spoilerFilter, updateUrl]);

  const handlePrefetchPage = useCallback((page: number) => {
    const cacheKey = `${page}-${spoilerFilter}-${languageFilter}`;
    if (prefetchCacheRef.current.has(cacheKey)) {
      const cached = prefetchCacheRef.current.get(cacheKey)!;
      preloadVNImages(cached.vns);
      return;
    }
    vndbStatsApi.getProducerVNsWithTags(producerId, page, 24, 'rating', spoilerFilter, languageFilter === 'all' ? undefined : languageFilter)
      .then(result => {
        if (result) {
          prefetchCacheRef.current.set(cacheKey, result);
          preloadVNImages(result.vns);
        }
      })
      .catch(() => {});
  }, [producerId, spoilerFilter, languageFilter]);

  if (isLoading) {
    return <LoadingScreen title="Loading developer stats..." subtitle="Crunching VNDB data for this developer" />;
  }

  if (error || !stats) {
    return <ErrorState error={error} producerId={producerId} />;
  }

  const producer = stats.producer;
  const producerDisplayName = getEntityDisplayName(producer, preference);
  const producerAltName = producerDisplayName === producer.name ? producer.original : producer.name;

  return (
    <div className="relative max-w-7xl mx-auto px-4 py-8 overflow-x-hidden">
      {isRefreshing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 dark:bg-gray-900/70 backdrop-blur-xs">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700">
            <RefreshCw className="w-4 h-4 animate-spin text-primary-500" />
            <span className="text-sm text-gray-700 dark:text-gray-200">Refreshing...</span>
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
            <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mb-2 flex-wrap">
              <Link href="/browse?tab=producers" className="hover:text-primary-600 dark:hover:text-primary-400">Producers</Link>
              <ChevronRight className="w-3 h-3 shrink-0" />
              <span className="text-gray-700 dark:text-gray-300">{producerDisplayName}</span>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-5 h-5 text-primary-500" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {producerDisplayName}
              </h1>
              {producer.type && (
                <span className="px-2 py-0.5 text-xs rounded-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                  {typeLabels[producer.type] || producer.type}
                </span>
              )}
            </div>
            {producerAltName && producerAltName !== producerDisplayName && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {producerAltName}
              </p>
            )}
            <a
              href={`https://vndb.org/${producer.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center gap-1 mt-1"
            >
              View on VNDB <ExternalLink className="w-3 h-3" />
            </a>
            {producer.description && (
              <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 max-w-2xl wrap-break-word">
                <p>
                  {parseBBCode(
                    !showFullDescription && producer.description.length > 300
                      ? producer.description.substring(0, 300) + '...'
                      : producer.description
                  )}
                </p>
                {producer.description.length > 300 && (
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
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || Date.now() < refreshBlockedUntil}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh data'}
          </button>
          <LastUpdated timestamp={stats?.last_updated} />
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav className="flex gap-4 -mb-px overflow-x-auto">
          <TabButton
            active={activeTab === 'summary'}
            onClick={() => handleTabChange('summary')}
            label="Summary"
          />
          <TabButton
            active={activeTab === 'novels'}
            onClick={() => handleTabChange('novels')}
            label="Novels"
            count={producer.vn_count}
          />
          <TabButton
            active={activeTab === 'similar'}
            onClick={() => handleTabChange('similar')}
            label="Similar Developers"
          />
        </nav>
      </div>

      {/* Summary Tab */}
      {activeTab === 'summary' && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatsSummaryCard
              icon={<Star className="w-5 h-5" />}
              label="Average Rating"
              value={stats.average_rating ? stats.average_rating.toFixed(2) : 'N/A'}
              subtext={`from ${stats.total_vns.toLocaleString()} rated VNs`}
            />
            <StatsSummaryCard
              icon={<Star className="w-5 h-5" />}
              label="Bayesian Rating"
              value={stats.bayesian_rating ? stats.bayesian_rating.toFixed(2) : 'N/A'}
              subtext="weighted by vote count"
            />
            <StatsSummaryCard
              icon={<BarChart3 className="w-5 h-5" />}
              label="Total Votes"
              value={stats.total_votes.toLocaleString()}
              subtext="cumulative votes"
            />
            <StatsSummaryCard
              icon={<BookOpen className="w-5 h-5" />}
              label="Visual Novels"
              value={producer.vn_count.toLocaleString()}
              subtext="as developer"
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <ScoreDistributionChart
              distribution={stats.score_distribution}
              jpDistribution={stats.score_distribution_jp}
              average={stats.average_rating ?? 0}
              entityId={producerId}
              entityType="producer"
              entityName={producerDisplayName}
            />
            <ReleaseYearChart
              distribution={stats.release_year_distribution}
              distributionWithRatings={stats.release_year_with_ratings}
              entityId={producerId}
              entityType="producer"
              entityName={producerDisplayName}
            />
            <LengthChart
              distribution={stats.length_distribution}
              entityId={producerId}
              entityType="producer"
              entityName={producerDisplayName}
            />
            {Object.keys(stats.age_rating_distribution).some(
              k => stats.age_rating_distribution[k].count > 0
            ) && (
              <AgeRatingChart
                distribution={stats.age_rating_distribution}
                entityId={producerId}
                entityType="producer"
                entityName={producerDisplayName}
              />
            )}
          </div>
        </>
      )}

      {/* Novels Tab */}
      {activeTab === 'novels' && (
        <div ref={resultsRef} className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          <div className="flex flex-wrap justify-end gap-2 mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <SpoilerFilter value={spoilerFilter} onChange={handleSpoilerChange} />
              <LanguageFilter value={languageFilter} onChange={handleLanguageChange} />
            </div>
          </div>
          <div>
            {/* Content - use cached data during loading for smooth transition */}
            {(() => {
              const displayVns = isLoadingTab && vns.length === 0 ? previousVnsRef.current : vns;
              return displayVns.length > 0 ? (
                <div className={isLoadingTab ? 'pointer-events-none' : ''}>
                  {vnsPages > 1 && (
                    <Pagination currentPage={vnsPage} totalPages={vnsPages} onPageChange={handlePageChange} onPrefetchPage={handlePrefetchPage} totalItems={vnsTotal} itemsPerPage={24} />
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {displayVns.map((vn) => (
                      <VNCard key={vn.id} vn={vn} />
                    ))}
                  </div>
                  {vnsPages > 1 && (
                    <Pagination currentPage={vnsPage} totalPages={vnsPages} onPageChange={handlePageChange} onPrefetchPage={handlePrefetchPage} totalItems={vnsTotal} itemsPerPage={24} scrollTargetRef={resultsRef} />
                  )}
                </div>
              ) : !isLoadingTab ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No visual novels found for this developer{languageFilter === 'ja' ? ' (Japanese only)' : ''}.
                </p>
              ) : (
                // Initial load skeleton
                <>
                  <PaginationSkeleton />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div key={i} className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                        <div className="flex gap-3">
                          <div className="w-16 h-20 rounded-sm image-placeholder" />
                          <div className="flex-1 space-y-2">
                            <div className="h-4 w-3/4 rounded-sm image-placeholder" />
                            <div className="h-3 w-1/2 rounded-sm image-placeholder" />
                            <div className="h-3 w-1/3 rounded-sm image-placeholder" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <PaginationSkeleton />
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Similar Developers Tab */}
      {activeTab === 'similar' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          {isLoadingTab ? (
            <LoadingTabContent message="Loading similar developers..." />
          ) : similarProducers.length > 0 ? (
            <div className="space-y-3">
              {similarProducers.map((prod) => (
                <SimilarProducerRow key={prod.id} producer={prod} />
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">
              No similar developers found.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-primary-500 text-primary-600 dark:text-primary-400'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
      }`}
    >
      {label}
      {count !== undefined && (
        <span className="ml-1.5 text-xs text-gray-400">({count.toLocaleString()})</span>
      )}
    </button>
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
      className="flex gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 shadow-xs hover:shadow-md hover:shadow-gray-200/40 dark:hover:shadow-none transition-all duration-200"
    >
      <div className="w-16 h-20 shrink-0 relative overflow-hidden rounded-sm">
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
          />
        ) : (
          <div className="absolute inset-0 bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
            <BookOpen className="w-6 h-6 text-gray-400" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-gray-900 dark:text-white text-sm truncate">
          {displayTitle}
        </h4>
        {vn.released && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {typeof vn.released === 'string' ? vn.released.substring(0, 4) : ''}
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
                className="px-1.5 py-0.5 text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-sm"
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

function SimilarProducerRow({ producer }: { producer: SimilarProducerResult }) {
  const { preference } = useTitlePreference();
  const displayName = getEntityDisplayName(producer, preference);
  const percentage = Math.round(producer.similarity);

  return (
    <Link
      href={`/stats/producer/${producer.id}`}
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Building2 className="w-4 h-4 text-primary-500 shrink-0" />
        <div className="min-w-0">
          <span className="font-medium text-gray-900 dark:text-white truncate">{displayName}</span>
          {producer.type && (
            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
              ({typeLabels[producer.type] || producer.type})
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-4">
        <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {producer.vn_count} VNs
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

function LoadingTabContent({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw className="w-6 h-6 animate-spin text-primary-500" />
      <span className="ml-2 text-gray-500 dark:text-gray-400">{message}</span>
    </div>
  );
}

function ErrorState({ error, producerId }: { error: string | null; producerId: string }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
        <AlertCircle className="w-8 h-8 text-red-500" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Unable to Load Developer
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {error || 'Something went wrong while loading the developer information.'}
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
          href={`https://vndb.org/${producerId.startsWith('p') ? producerId : `p${producerId}`}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Try on VNDB
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
