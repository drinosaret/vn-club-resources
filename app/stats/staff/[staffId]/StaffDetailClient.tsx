'use client';

import { useEffect, useState, useRef, use, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import {
  ArrowLeft, ExternalLink, Pen, Star, BarChart3,
  AlertCircle, RefreshCw, BookOpen, ChevronRight
} from 'lucide-react';
import {
  vndbStatsApi,
  StaffStatsData,
  TagVN,
} from '@/lib/vndb-stats-api';
import { StatsSummaryCard } from '@/components/stats/StatsSummaryCard';
import { ScoreDistributionChart } from '@/components/stats/ScoreDistributionChart';
import { ReleaseYearChart } from '@/components/stats/ReleaseYearChart';
import { LengthChart } from '@/components/stats/LengthChart';
import { AgeRatingChart } from '@/components/stats/AgeRatingChart';
import { LoadingScreen } from '@/components/LoadingScreen';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { LastUpdated } from '@/components/stats/LastUpdated';
import { useTitlePreference, getDisplayTitle, getEntityDisplayName } from '@/lib/title-preference';
import { LanguageFilter, LanguageFilterValue } from '@/components/stats/LanguageFilter';
import { SpoilerFilter, SpoilerFilterValue } from '@/components/stats/SpoilerFilter';
import { sortTagsByWeight } from '@/lib/weighted-score-utils';
import { parseBBCode } from '@/lib/bbcode';
import { Pagination, PaginationSkeleton } from '@/components/browse/Pagination';
import { NSFWImage } from '@/components/NSFWImage';

/** Preload VN cover images into browser cache using Image() objects */
function preloadVNImages(vns: Array<{ image_url?: string | null; id: string }>) {
  vns.forEach(vn => {
    if (vn.image_url) {
      const img = new Image();
      const url = getProxiedImageUrl(vn.image_url, { vnId: vn.id });
      if (url) img.src = url;
    }
  });
}

// Role labels for display
const ROLE_LABELS: Record<string, string> = {
  scenario: 'Scenario',
  art: 'Art',
  music: 'Music',
  songs: 'Songs',
  director: 'Director',
  chardesign: 'Character Design',
  staff: 'Staff',
  editor: 'Editor',
  qa: 'QA',
  translator: 'Translator',
};

type TabId = 'summary' | 'novels';
const VALID_TABS: TabId[] = ['summary', 'novels'];

interface PageProps {
  params: Promise<{ staffId: string }>;
}

export default function StaffDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const staffId = resolvedParams.staffId;

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabFromUrl = searchParams.get('tab') as TabId | null;
  const pageFromUrl = searchParams.get('page');
  const initialPage = pageFromUrl ? Math.max(1, parseInt(pageFromUrl, 10) || 1) : 1;

  const [stats, setStats] = useState<StaffStatsData | null>(null);
  const [vns, setVns] = useState<TagVN[]>([]);
  const [vnsPage, setVnsPage] = useState(initialPage);
  const [vnsTotal, setVnsTotal] = useState(0);
  const [vnsPages, setVnsPages] = useState(1);
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
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'summary') params.delete('tab');
    else params.set('tab', tab);
    if (page <= 1) params.delete('page');
    else params.set('page', String(page));
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [pathname, router, searchParams]);

  // Cache previous VNs for smooth loading overlay
  const previousVnsRef = useRef<TagVN[]>([]);
  const prefetchCacheRef = useRef<Map<string, { vns: TagVN[]; page: number; pages: number; total: number }>>(new Map());
  useEffect(() => {
    if (vns.length > 0) previousVnsRef.current = vns;
  }, [vns]);

  const staffDisplayName = stats?.staff ? getEntityDisplayName(stats.staff, preference) : '';
  const staffAltName = stats?.staff ? (staffDisplayName === stats.staff.name ? stats.staff.original : stats.staff.name) : '';

  useEffect(() => {
    loadInitialData();
  }, [staffId]);

  // Set page title
  useEffect(() => {
    if (stats && staffDisplayName) {
      document.title = `${staffDisplayName} - Staff | VN Club`;
    }
  }, [stats, staffDisplayName]);

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
    } else if (urlPage !== vnsPage && urlTab === 'novels' && vns.length > 0) {
      setVnsPage(urlPage);
      loadNovels(urlPage);
    }
  }, [tabFromUrl, pageFromUrl]);

  // Lazy load tab data
  useEffect(() => {
    if (activeTab === 'novels' && vns.length === 0 && !isLoadingTab) {
      loadNovels(vnsPage);
    }
  }, [activeTab, vns.length]);

  const loadInitialData = async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const statsData = await vndbStatsApi.getStaffStats(staffId, { nocache: forceRefresh });

      if (!statsData) {
        setError('Staff member not found or backend unavailable.');
        return;
      }

      setStats(statsData);
    } catch {
      setError('Failed to load staff data.');
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
          vndbStatsApi.getStaffVNsWithTags(staffId, cached.page + 1, 24, 'rating', spoilerLevel, olang === 'all' ? undefined : olang)
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
      const response = await vndbStatsApi.getStaffVNsWithTags(staffId, page, 24, 'rating', spoilerLevel, olang === 'all' ? undefined : olang);
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
            vndbStatsApi.getStaffVNsWithTags(staffId, response.page + 1, 24, 'rating', spoilerLevel, olang === 'all' ? undefined : olang)
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

  const handleTabChange = useCallback((newTab: TabId) => {
    prefetchCacheRef.current.clear();
    setActiveTab(newTab);
    setVnsPage(1);
    setVns([]);
    updateUrl(newTab, 1);
  }, [updateUrl]);

  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1 && newPage <= vnsPages) {
      loadNovels(newPage);
      updateUrl(activeTab, newPage);
    }
  }, [activeTab, vnsPages, updateUrl]);

  const handleSpoilerChange = useCallback((value: SpoilerFilterValue) => {
    prefetchCacheRef.current.clear();
    setSpoilerFilter(value);
    setVnsPage(1);
    loadNovels(1, value);
    updateUrl(activeTab, 1);
  }, [activeTab, updateUrl]);

  const handleLanguageChange = useCallback((value: LanguageFilterValue) => {
    prefetchCacheRef.current.clear();
    setLanguageFilter(value);
    setVnsPage(1);
    loadNovels(1, spoilerFilter, value);
    updateUrl(activeTab, 1);
  }, [activeTab, spoilerFilter, updateUrl]);

  if (isLoading) {
    return <LoadingScreen title="Loading staff stats..." subtitle="Crunching VNDB data for this staff member" />;
  }

  if (error || !stats) {
    return <ErrorState error={error} staffId={staffId} />;
  }

  const staff = stats.staff;

  return (
    <div className="relative max-w-7xl mx-auto px-4 py-8 overflow-x-hidden">
      {isRefreshing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-gray-800 shadow border border-gray-200 dark:border-gray-700">
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
              <Link href="/browse?tab=staff" className="hover:text-primary-600 dark:hover:text-primary-400">Staff</Link>
              <ChevronRight className="w-3 h-3 flex-shrink-0" />
              <span className="text-gray-700 dark:text-gray-300">{staffDisplayName}</span>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <Pen className="w-5 h-5 text-primary-500" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {staffDisplayName}
              </h1>
              {staff.gender && (
                <span className="px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                  {staff.gender === 'm' ? 'Male' : staff.gender === 'f' ? 'Female' : staff.gender}
                </span>
              )}
            </div>
            {staffAltName && staffAltName !== staffDisplayName && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {staffAltName}
              </p>
            )}
            <a
              href={`https://vndb.org/${staff.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center gap-1 mt-1"
            >
              View on VNDB <ExternalLink className="w-3 h-3" />
            </a>
            {/* Role badges */}
            {Object.keys(stats.role_breakdown).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {Object.entries(stats.role_breakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([role, count]) => (
                    <span
                      key={role}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400"
                    >
                      {ROLE_LABELS[role] || role}
                      <span className="text-primary-500 dark:text-primary-300">({count})</span>
                    </span>
                  ))}
              </div>
            )}
            {staff.description && (
              <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 max-w-2xl break-words">
                <p>
                  {parseBBCode(
                    !showFullDescription && staff.description.length > 300
                      ? staff.description.substring(0, 300) + '...'
                      : staff.description
                  )}
                </p>
                {staff.description.length > 300 && (
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
            count={staff.vn_count}
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
              value={staff.vn_count.toLocaleString()}
              subtext="worked on"
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <ScoreDistributionChart
              distribution={stats.score_distribution}
              jpDistribution={stats.score_distribution_jp}
              average={stats.average_rating ?? 0}
              entityId={staffId}
              entityType="staff"
              entityName={staffDisplayName}
            />
            <ReleaseYearChart
              distribution={stats.release_year_distribution}
              distributionWithRatings={stats.release_year_with_ratings}
              entityId={staffId}
              entityType="staff"
              entityName={staffDisplayName}
            />
            <LengthChart
              distribution={stats.length_distribution}
              entityId={staffId}
              entityType="staff"
              entityName={staffDisplayName}
            />
            {Object.keys(stats.age_rating_distribution).some(
              k => stats.age_rating_distribution[k].count > 0
            ) && (
              <AgeRatingChart
                distribution={stats.age_rating_distribution}
                entityId={staffId}
                entityType="staff"
                entityName={staffDisplayName}
              />
            )}
          </div>
        </>
      )}

      {/* Novels Tab */}
      {activeTab === 'novels' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
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
                <div className={`transition-opacity duration-150 ${isLoadingTab ? 'opacity-60 pointer-events-none' : ''}`}>
                  {vnsPages > 1 && (
                    <Pagination currentPage={vnsPage} totalPages={vnsPages} onPageChange={handlePageChange} />
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {displayVns.map((vn) => (
                      <VNCard key={vn.id} vn={vn} />
                    ))}
                  </div>
                  {vnsPages > 1 && (
                    <Pagination currentPage={vnsPage} totalPages={vnsPages} onPageChange={handlePageChange} scrollToTop={true} />
                  )}
                </div>
              ) : !isLoadingTab ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No visual novels found for this staff member{languageFilter === 'ja' ? ' (Japanese only)' : ''}.
                </p>
              ) : (
                // Initial load skeleton
                <>
                  <PaginationSkeleton />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div key={i} className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                        <div className="flex gap-3">
                          <div className="w-16 h-20 rounded image-placeholder" />
                          <div className="flex-1 space-y-2">
                            <div className="h-4 w-3/4 rounded image-placeholder" />
                            <div className="h-3 w-1/2 rounded image-placeholder" />
                            <div className="h-3 w-1/3 rounded image-placeholder" />
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
  const [imageLoaded, setImageLoaded] = useState(false);
  const displayTitle = getDisplayTitle({ title: vn.title, title_jp: vn.title_jp || vn.alttitle, title_romaji: vn.title_romaji }, preference);

  return (
    <Link
      href={`/vn/${vn.id}`}
      className="flex gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 shadow-sm hover:shadow-md hover:shadow-gray-200/40 dark:hover:shadow-none transition-all duration-200"
    >
      <div className="w-16 h-20 flex-shrink-0 relative overflow-hidden rounded">
        {/* Shimmer placeholder - visible until image loads */}
        <div className={`absolute inset-0 image-placeholder transition-opacity duration-300 ${imageLoaded ? 'opacity-0' : 'opacity-100'}`} />
        {vn.image_url ? (
          <NSFWImage
            src={getProxiedImageUrl(vn.image_url, { vnId: vn.id })}
            alt={displayTitle}
            vnId={vn.id}
            imageSexual={vn.image_sexual}
            className={`w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setImageLoaded(true)}
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

function LoadingTabContent({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw className="w-6 h-6 animate-spin text-primary-500" />
      <span className="ml-2 text-gray-500 dark:text-gray-400">{message}</span>
    </div>
  );
}

function ErrorState({ error, staffId }: { error: string | null; staffId: string }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
        <AlertCircle className="w-8 h-8 text-red-500" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Unable to Load Staff Member
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {error || 'Something went wrong while loading the staff information.'}
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
          href={`https://vndb.org/${staffId.startsWith('s') ? staffId : `s${staffId}`}`}
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
