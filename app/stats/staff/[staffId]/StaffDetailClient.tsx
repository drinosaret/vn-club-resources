'use client';

import { useEffect, useState, useRef, use, useCallback } from 'react';
import Link from '@/components/Link';
import { useSearchParams, usePathname } from 'next/navigation';
import { ArrowLeft, ExternalLink, RefreshCw, ChevronRight } from 'lucide-react';
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
import { useImageRetry } from '@/hooks/useImageRetry';
import { preloadVNImages, addRetryKey } from '@/lib/preload-images';

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

  const staffDisplayName = stats?.staff ? getEntityDisplayName(stats.staff, preference) : '';
  const staffAltName = stats?.staff ? (staffDisplayName === stats.staff.name ? stats.staff.original : stats.staff.name) : '';

  useEffect(() => {
    loadInitialData();
  }, [staffId]);

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
    vndbStatsApi.getStaffVNsWithTags(staffId, page, 24, 'rating', spoilerFilter, languageFilter === 'all' ? undefined : languageFilter)
      .then(result => {
        if (result) {
          prefetchCacheRef.current.set(cacheKey, result);
          preloadVNImages(result.vns);
        }
      })
      .catch(() => {});
  }, [staffId, spoilerFilter, languageFilter]);

  if (isLoading) {
    return <LoadingScreen title="Loading staff stats..." subtitle="Crunching VNDB data for this staff member" />;
  }

  if (error || !stats) {
    return <ErrorState error={error} staffId={staffId} />;
  }

  const staff = stats.staff;

  return (
    <div className="relative max-w-7xl mx-auto px-4 py-8 overflow-x-clip">
      {isRefreshing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[color:var(--surface)] backdrop-blur-xs">
          <div className="flex items-center gap-2 px-4 py-2 rounded-xs bg-[color:var(--surface)] border border-[color:var(--rule)]">
            <RefreshCw className="w-4 h-4 animate-spin text-[color:var(--ai)]" />
            <span className="text-sm text-[color:var(--text-secondary)]">Refreshing...</span>
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
            <div className="flex items-center gap-1 text-sm text-[color:var(--nezu)] mb-2 flex-wrap">
              <Link href="/browse?tab=staff" className="hover:text-[color:var(--ai)]">Staff</Link>
              <ChevronRight className="w-3 h-3 shrink-0" />
              <span className="text-[color:var(--text-secondary)]">{staffDisplayName}</span>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="sec-title">
                {staffDisplayName}
              </h1>
              {staff.gender && (
                <span className="st-badge">
                  {staff.gender === 'm' ? 'Male' : staff.gender === 'f' ? 'Female' : staff.gender}
                </span>
              )}
            </div>
            {staffAltName && staffAltName !== staffDisplayName && (
              <p className="text-sm text-[color:var(--nezu)]">
                {staffAltName}
              </p>
            )}
            <a
              href={`https://vndb.org/${staff.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="sec-more mt-1"
            >
              View on VNDB <span aria-hidden>&rarr;</span>
            </a>
            {/* Role badges */}
            {Object.keys(stats.role_breakdown).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {Object.entries(stats.role_breakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([role, count]) => (
                    <span
                      key={role}
                      className="st-badge"
                    >
                      {ROLE_LABELS[role] || role}
                      <span className="text-[color:var(--ai)]">({count})</span>
                    </span>
                  ))}
              </div>
            )}
            {staff.description && (
              <div className="mt-3 text-sm text-[color:var(--nezu)] max-w-2xl wrap-break-word">
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
                    className="sec-more mt-1"
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
            className="st-act disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh data'}
          </button>
          <LastUpdated timestamp={stats?.last_updated} />
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <nav className="tabs flex-nowrap overflow-x-auto">
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatsSummaryCard
              label="Average Rating"
              value={stats.average_rating ? stats.average_rating.toFixed(2) : 'N/A'}
              subtext={`from ${stats.total_vns.toLocaleString()} rated VNs`}
            />
            <StatsSummaryCard
              label="Bayesian Rating"
              value={stats.bayesian_rating ? stats.bayesian_rating.toFixed(2) : 'N/A'}
              subtext="weighted by vote count"
            />
            <StatsSummaryCard
              label="Total Votes"
              value={stats.total_votes.toLocaleString()}
              subtext="cumulative votes"
            />
            <StatsSummaryCard
              label="Visual Novels"
              value={staff.vn_count.toLocaleString()}
              subtext="worked on"
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <ScoreDistributionChart headingLevel="h2"
              distribution={stats.score_distribution}
              jpDistribution={stats.score_distribution_jp}
              average={stats.average_rating ?? 0}
              entityId={staffId}
              entityType="staff"
              entityName={staffDisplayName}
            />
            <ReleaseYearChart headingLevel="h2"
              distribution={stats.release_year_distribution}
              distributionWithRatings={stats.release_year_with_ratings}
              entityId={staffId}
              entityType="staff"
              entityName={staffDisplayName}
            />
            <LengthChart headingLevel="h2"
              distribution={stats.length_distribution}
              entityId={staffId}
              entityType="staff"
              entityName={staffDisplayName}
            />
            {Object.keys(stats.age_rating_distribution).some(
              k => stats.age_rating_distribution[k].count > 0
            ) && (
              <AgeRatingChart headingLevel="h2"
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
        <div ref={resultsRef} className="st-card p-6">
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
                <p className="st-card-sub py-8 text-center">
                  No visual novels found for this staff member{languageFilter === 'ja' ? ' (Japanese only)' : ''}.
                </p>
              ) : (
                // Initial load skeleton
                <>
                  <PaginationSkeleton />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div key={i} className="st-card p-4">
                        <div className="flex gap-3">
                          <div className="w-16 h-20 rounded-xs image-placeholder" />
                          <div className="flex-1 space-y-2">
                            <div className="h-4 w-3/4 rounded-xs image-placeholder" />
                            <div className="h-3 w-1/2 rounded-xs image-placeholder" />
                            <div className="h-3 w-1/3 rounded-xs image-placeholder" />
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
      className={`tab ${active ? 'tab--on' : ''}`}
    >
      {label}
      {count !== undefined && (
        <span className="tab-count">{count.toLocaleString()}</span>
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
            {typeof vn.released === 'string' ? vn.released.substring(0, 4) : ''}
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

function LoadingTabContent({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw className="w-6 h-6 animate-spin text-[color:var(--ai)]" />
      <span className="ml-2 text-[color:var(--nezu)]">{message}</span>
    </div>
  );
}

function ErrorState({ error, staffId }: { error: string | null; staffId: string }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <h1 className="sec-title mb-2">
        Unable to Load Staff Member
      </h1>
      <p className="text-[color:var(--nezu)] mb-6">
        {error || 'Something went wrong while loading the staff information.'}
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
          href={`https://vndb.org/${staffId.startsWith('s') ? staffId : `s${staffId}`}`}
          target="_blank"
          rel="noopener noreferrer"
          className="st-act"
        >
          Try on VNDB
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
