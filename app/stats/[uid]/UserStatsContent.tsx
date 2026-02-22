'use client';

import { useEffect, useState, useCallback, useRef, useMemo, startTransition, memo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, ExternalLink, Clock,
  BookOpen, Star, Trophy, AlertCircle, Sparkles, UserCheck
} from 'lucide-react';
import {
  vndbStatsApi,
  UserStats,
  TagAnalytics,
  VNDBListItem,
  formatScore,
  formatHours,
  getVNDBUserUrl,
} from '@/lib/vndb-stats-api';
import { StatsSummaryCard } from '@/components/stats/StatsSummaryCard';
import { ScoreDistributionChart } from '@/components/stats/ScoreDistributionChart';
import { ReleaseYearChart } from '@/components/stats/ReleaseYearChart';
import { LengthChart } from '@/components/stats/LengthChart';
import { AgeRatingChart } from '@/components/stats/AgeRatingChart';
import { TagsSection } from '@/components/stats/TagsSection';
import { NovelsSection } from '@/components/stats/NovelsSection';
import { DevelopersSection } from '@/components/stats/DevelopersSection';
import { PublishersSection } from '@/components/stats/PublishersSection';
import { StaffSection } from '@/components/stats/StaffSection';
import { SeiyuuSection } from '@/components/stats/SeiyuuSection';
import { TraitsSection } from '@/components/stats/TraitsSection';
import { TrendsSection } from '@/components/stats/TrendsSection';
import { UserStatsTabs, StatsTabId } from '@/components/stats/UserStatsTabs';
import { StatsLoadingScreen } from '@/components/stats/StatsLoadingScreen';
import { LastUpdated } from '@/components/stats/LastUpdated';
import { useLoadingProgress } from '@/hooks/useLoadingProgress';
import { STATS_LOADING_STAGES } from '@/lib/loading-stages';
import { consumePendingScroll } from '@/components/ScrollToTop';

interface UserStatsContentProps {
  uid: string;
  initialUsername?: string;
  initialTab?: string;
}

// Valid tab IDs for URL validation
const VALID_TABS: StatsTabId[] = ['summary', 'trends', 'novels', 'tags', 'developers', 'publishers', 'staff', 'seiyuu', 'traits'];

// Session storage cache helpers for instant back navigation
// Only refresh cached data if older than this duration (avoids rate limiting on back/forward navigation)
const CACHE_FRESH_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(uid: string) {
  return `stats-cache-${uid}`;
}

function getNovelsCacheKey(uid: string) {
  return `novels-cache-${uid}`;
}

interface CachedStatsData {
  stats: UserStats;
  tags: TagAnalytics | null;
  cachedAt: number;
}

// Validate that parsed data matches expected CachedStatsData structure
function isValidCachedData(data: unknown): data is CachedStatsData {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  // Must have stats object with user property
  if (!obj.stats || typeof obj.stats !== 'object') return false;
  const stats = obj.stats as Record<string, unknown>;
  if (!stats.user || typeof stats.user !== 'object') return false;
  // tags can be null, but must exist
  if (!('tags' in obj)) return false;
  return true;
}

function getCachedData(uid: string): CachedStatsData | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = sessionStorage.getItem(getCacheKey(uid));
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    // Validate structure before using
    if (!isValidCachedData(parsed)) {
      console.warn('Invalid cached stats data structure, ignoring cache');
      sessionStorage.removeItem(getCacheKey(uid));
      return null;
    }
    // Handle legacy cache format without cachedAt
    if (!parsed.cachedAt) {
      return { ...parsed, cachedAt: 0 };
    }
    return parsed;
  } catch {
    return null;
  }
}

function setCachedData(uid: string, stats: UserStats, tags: TagAnalytics | null) {
  if (typeof window === 'undefined') return;
  try {
    const data: CachedStatsData = { stats, tags, cachedAt: Date.now() };
    sessionStorage.setItem(getCacheKey(uid), JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

function isCacheFresh(cachedAt: number): boolean {
  return Date.now() - cachedAt < CACHE_FRESH_DURATION_MS;
}

// Validate that parsed data is an array of VNDBListItem-like objects
function isValidNovelsCache(data: unknown): data is VNDBListItem[] {
  if (!Array.isArray(data)) return false;
  // Validate first few items have expected structure
  const samplesToCheck = Math.min(data.length, 3);
  for (let i = 0; i < samplesToCheck; i++) {
    const item = data[i];
    if (!item || typeof item !== 'object') return false;
    // VNDBListItem must have vn property with id
    if (!('vn' in item) || !item.vn || typeof item.vn !== 'object') return false;
    const vn = item.vn as Record<string, unknown>;
    if (typeof vn.id !== 'string') return false;
  }
  return true;
}

function getCachedNovels(uid: string): VNDBListItem[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = sessionStorage.getItem(getNovelsCacheKey(uid));
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    // Validate structure before using
    if (!isValidNovelsCache(parsed)) {
      console.warn('Invalid cached novels data structure, ignoring cache');
      sessionStorage.removeItem(getNovelsCacheKey(uid));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function setCachedNovels(uid: string, novels: VNDBListItem[]) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(getNovelsCacheKey(uid), JSON.stringify(novels));
  } catch {
    // Ignore storage errors
  }
}

export default function UserStatsContent({ uid, initialUsername, initialTab }: UserStatsContentProps) {
  // Always start with loading state to avoid hydration mismatch
  // Cache is checked in useEffect after mount
  const [stats, setStats] = useState<UserStats | null>(null);
  const [tags, setTags] = useState<TagAnalytics | null>(null);
  const [novels, setNovels] = useState<VNDBListItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingNovels, setIsLoadingNovels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Initialize tab from server-provided URL param, default to 'summary'
  const initialTabValue = initialTab && VALID_TABS.includes(initialTab as StatsTabId) ? initialTab as StatsTabId : 'summary';
  const [activeTab, setActiveTab] = useState<StatsTabId>(initialTabValue);
  // Track which tabs have been visited — they stay mounted (display:none) after first visit
  // so switching back is instant (no expensive unmount/remount of SVG charts etc.)
  const [mountedTabs, setMountedTabs] = useState<Set<StatsTabId>>(() => new Set([initialTabValue]));
  const [usingFallback, setUsingFallback] = useState(false);
  // Track if we've checked the cache (to avoid double-loading)
  const cacheCheckedRef = useRef(false);
  // Track if cache check is complete - prevents loading screen flash when navigating back
  const [cacheCheckComplete, setCacheCheckComplete] = useState(false);
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

  // Handle tab change - update URL for bookmarkability
  // Uses native History.prototype.replaceState to bypass Next.js's patched version,
  // which would trigger a soft navigation and potentially flash loading.tsx's Suspense boundary
  const handleTabChange = useCallback((newTab: StatsTabId) => {
    setActiveTab(newTab);
    // Lazily mount tabs on first visit — they stay in the DOM (display:none) afterward
    // so switching back never triggers expensive unmount/remount of SVG charts
    setMountedTabs(prev => {
      if (prev.has(newTab)) return prev;
      const next = new Set(prev);
      next.add(newTab);
      return next;
    });
    const url = new URL(window.location.href);
    if (newTab === 'summary') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', newTab);
    }
    History.prototype.replaceState.call(history, history.state, '', url.toString());
  }, []);

  // Progress tracking for loading screen
  const loadingProgress = useLoadingProgress(STATS_LOADING_STAGES);

  // Track if component is mounted to prevent state updates after unmount
  const [loadKey, setLoadKey] = useState(0);

  // Ref to track if we should force refresh on next load
  const forceRefreshRef = useRef(false);

  // Core data loading function
  const performLoad = useCallback(async (
    currentUid: string,
    username: string | null,
    progress: ReturnType<typeof useLoadingProgress>,
    signal: { cancelled: boolean },
    forceRefresh: boolean = false
  ) => {
    progress.start();

    try {
      // Stage 1: Connecting
      progress.setStage('connecting');
      if (signal.cancelled) return null;

      // Stage 2: Fetching stats
      progress.setStage('fetching-stats');
      const statsData = await vndbStatsApi.getUserStats(currentUid, username || undefined, forceRefresh);
      if (signal.cancelled) return null;

      // Stage 3: Analyzing tags (only fetch if stats show we have VNs)
      progress.setStage('analyzing-tags');
      const fallbackMode = await vndbStatsApi.isUsingFallback().catch(() => false);
      if (signal.cancelled) return null;

      // Only fetch tag analytics if user has completed VNs - avoids race conditions
      // where tags might return empty because user data isn't fully processed yet
      const tagsData = statsData.summary.total_vns > 0
        ? await vndbStatsApi.getTagAnalytics(currentUid).catch(() => null)
        : null;
      if (signal.cancelled) return null;

      // Stage 4: Finalizing
      progress.setStage('finalizing');
      progress.complete();

      return { statsData, tagsData, fallbackMode };
    } catch (e) {
      if (signal.cancelled) return null;
      progress.setError('Failed to load user stats');
      throw e;
    }
  }, []);

  // Load data with progress tracking
  useEffect(() => {
    const signal = { cancelled: false };
    const shouldForceRefresh = forceRefreshRef.current;
    forceRefreshRef.current = false; // Reset for next load

    // Check sessionStorage cache on mount (client-side only)
    // This enables instant back navigation without hydration mismatch
    if (!cacheCheckedRef.current) {
      cacheCheckedRef.current = true;
      const cachedData = getCachedData(uid);
      const cachedNovels = getCachedNovels(uid);
      if (cachedData) {
        setStats(cachedData.stats);
        setTags(cachedData.tags);
        if (cachedNovels) {
          setNovels(cachedNovels);
        }
        setIsLoading(false);
        // Restore scroll position after cache-based render on back navigation
        if (isInitialBackNavRef.current) {
          isInitialBackNavRef.current = false;
          consumePendingScroll();
        }
        // Only fetch fresh data in background if cache is stale (> 5 minutes old)
        // This prevents rate limiting when users navigate back/forward quickly
        if (!isCacheFresh(cachedData.cachedAt)) {
          performLoad(uid, initialUsername ?? null, loadingProgress, signal, false)
            .then(result => {
              if (!signal.cancelled && result) {
                setStats(result.statsData);
                setTags(result.tagsData);
                setUsingFallback(result.fallbackMode);
                setCachedData(uid, result.statsData, result.tagsData);
              }
            })
            .catch(() => {
              // Silently fail background refresh - we already have cached data
            });
        }
        return;
      }
      // No cache found - mark check complete so loading screen can show
      setCacheCheckComplete(true);
    }

    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await performLoad(uid, initialUsername ?? null, loadingProgress, signal, shouldForceRefresh);
        if (signal.cancelled || !result) return;

        setStats(result.statsData);
        setTags(result.tagsData);
        setUsingFallback(result.fallbackMode);
        // Cache for instant back navigation
        setCachedData(uid, result.statsData, result.tagsData);
      } catch (e) {
        if (signal.cancelled) return;

        // Provide specific error messages based on the actual error
        let errorMessage = 'Failed to load user stats.';

        if (e instanceof Error) {
          if (e.message === 'Not found') {
            errorMessage = 'User not found. The user may not exist or their list may be private.';
          } else if (e.message.includes('timed out')) {
            errorMessage = 'Request timed out. The server may be busy processing a large collection. Please try again.';
          } else if (e.message.includes('429')) {
            errorMessage = 'Too many requests. Please wait a moment before trying again.';
          } else if (e.message.includes('API error: 5')) {
            errorMessage = 'Server error. Please try again later.';
          } else if (e.message.includes('API error:')) {
            errorMessage = `Server returned an error: ${e.message}`;
          } else if (e.message.includes('fetch') || e.message.includes('network')) {
            errorMessage = 'Network error. Please check your connection and try again.';
          } else {
            errorMessage = `Failed to load user stats: ${e.message}`;
          }
        }

        setError(errorMessage);
      } finally {
        if (!signal.cancelled) {
          setIsLoading(false);
          // Restore scroll position after API-based render on back navigation
          if (isInitialBackNavRef.current) {
            isInitialBackNavRef.current = false;
            consumePendingScroll();
          }
        }
      }
    };

    loadData();

    return () => {
      signal.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, initialUsername, loadKey]);

  // Set page title
  useEffect(() => {
    if (stats) {
      document.title = `${stats.user.username}'s Stats | VN Club`;
    }
  }, [stats]);

  // Lazy load novels when tab is selected (needed for novels and trends tabs)
  useEffect(() => {
    if ((activeTab === 'novels' || activeTab === 'trends') && novels === null && !isLoadingNovels) {
      loadNovels();
    }
  }, [activeTab, novels, isLoadingNovels]);

  const loadNovels = async () => {
    setIsLoadingNovels(true);
    try {
      const PAGE_SIZE = 2000;
      // First request — gives us total count + first batch
      const first = await vndbStatsApi.getUserVNList(uid, 1, PAGE_SIZE);
      const allNovels: VNDBListItem[] = [...first.items];

      if (first.has_more && first.total) {
        // Fetch remaining pages in parallel
        const totalPages = Math.ceil(first.total / PAGE_SIZE);
        const remaining = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, i) =>
            vndbStatsApi.getUserVNList(uid, i + 2, PAGE_SIZE)
          )
        );
        for (const resp of remaining) {
          allNovels.push(...resp.items);
        }
      }

      // Use startTransition so the heavy render (315 novels → 24 cards + pagination)
      // is time-sliced and doesn't block the main thread / flash the sidebar
      startTransition(() => {
        setNovels(allNovels);
        setIsLoadingNovels(false);
      });
      // Cache for instant back navigation
      setCachedNovels(uid, allNovels);
    } catch (err) {
      console.error('Failed to load novels:', err);
      setNovels([]);
      setIsLoadingNovels(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await vndbStatsApi.refreshUserData(uid);
      // Trigger a reload with force refresh enabled
      forceRefreshRef.current = true;
      loadingProgress.reset();
      setLoadKey((k) => k + 1);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Memoize tab counts so UserStatsTabs (wrapped in React.memo) can skip re-renders
  // when unrelated state changes (e.g. novels loading) don't affect the sidebar
  const tabCounts = useMemo(() => ({
    novels: stats?.summary.total_vns || undefined,
    tags: tags?.top_tags?.length || undefined,
    developers: stats?.developers_breakdown?.length || undefined,
    publishers: stats?.publishers_breakdown?.length || undefined,
    staff: stats?.staff_breakdown?.length || undefined,
    seiyuu: stats?.seiyuu_breakdown?.length || undefined,
    traits: stats?.traits_breakdown?.length || undefined,
  }), [stats, tags]);

  // Brief pause while checking cache - show a minimal spinner so the page
  // isn't completely blank between hydration and the first useEffect firing
  if (isLoading && !cacheCheckComplete && !stats) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-primary-500/40" />
      </div>
    );
  }

  // Only show loading screen after cache check is complete (no cache found)
  // This prevents a flash of loading screen when navigating back with cached data
  if (isLoading && cacheCheckComplete) {
    return (
      <StatsLoadingScreen
        username={initialUsername || undefined}
        stages={loadingProgress.stages}
        currentStage={loadingProgress.currentStage}
        elapsedTime={loadingProgress.elapsedTime}
        hasError={loadingProgress.hasError}
      />
    );
  }

  if (error || !stats) {
    return <ErrorState error={error} uid={uid} />;
  }

  return (
    <div className="relative max-w-7xl mx-auto px-4 py-8 overflow-x-hidden">
      {isRefreshing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 dark:bg-gray-900/70 backdrop-blur-xs">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700">
            <RefreshCw className="w-4 h-4 animate-spin text-primary-500" />
            <span className="text-sm text-gray-700 dark:text-gray-200">Refreshing…</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Top row: Back button, username, action buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <button
              onClick={() => window.history.back()}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <span className="truncate">{stats.user.username}</span>
                <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-sm bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 shrink-0">
                  BETA
                </span>
              </h1>
              <a
                href={getVNDBUserUrl(uid)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center gap-1"
              >
                View on VNDB <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <Link
              href={`/recommendations?uid=${uid}&username=${encodeURIComponent(stats.user.username)}`}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline">Recommendations</span>
              <span className="sm:hidden">Recs</span>
            </Link>
            <Link
              href={`/stats/compare?mode=similar&user1=${uid}`}
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              <UserCheck className="w-4 h-4" />
              <span className="hidden sm:inline">Similar Users</span>
              <span className="sm:hidden">Similar</span>
            </Link>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors text-sm font-medium"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
        <LastUpdated timestamp={stats?.last_updated} className="mt-2 sm:mt-0 sm:ml-auto" />
      </div>

      {/* Fallback Mode Warning */}
      {usingFallback && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                Limited Data Mode
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                Some statistics may be limited or unavailable. Please try again later for full features.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar + Content layout (column on mobile, row on desktop) */}
      <div className="flex flex-col md:flex-row md:gap-8">
        <UserStatsTabs
          activeTab={activeTab}
          onTabChange={handleTabChange}
          counts={tabCounts}
        />

        {/* Main Content — each tab panel stays mounted after first visit (display:none)
            so switching tabs is instant (no expensive SVG chart unmount/remount) */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {/* Summary Tab */}
          <TabPanel active={activeTab === 'summary'}>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatsSummaryCard
              icon={<BookOpen className="w-5 h-5" />}
              label="Total VNs"
              value={stats.summary.total_vns.toString()}
              subtext={`${stats.summary.completed} completed`}
              tooltip="All VNs on your VNDB list. Count is based on database dump (updated daily) and may differ slightly from VNDB's displayed count."
            />
            <StatsSummaryCard
              icon={<Star className="w-5 h-5" />}
              label="Average Score"
              value={formatScore(stats.summary.average_score)}
              subtext={`${stats.summary.total_votes} votes`}
              tooltip="Mean of votes on finished VNs (VNDB 10-100 scale converted to 1-10). Vote count includes all voted VNs."
            />
            <StatsSummaryCard
              icon={<Clock className="w-5 h-5" />}
              label="Est. Hours"
              value={formatHours(stats.summary.estimated_hours)}
              subtext={
                stats.summary.average_hours_per_vn && stats.summary.vns_with_length_data
                  ? `~${Math.round(stats.summary.average_hours_per_vn)}h avg per VN (${stats.summary.vns_with_length_data}/${stats.summary.completed} with data)`
                  : 'reading time'
              }
              tooltip="Sum of estimated playtime for finished VNs using VNDB length data (not all VNs have length info)"
            />
            <StatsSummaryCard
              icon={<Trophy className="w-5 h-5" />}
              label="Wishlist"
              value={stats.summary.wishlist.toString()}
              subtext="to read"
              tooltip="VNs marked as 'Wishlist' on your VNDB list"
            />
          </div>

          {/* Charts - only show when there's data */}
          {stats.summary.total_vns > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <ScoreDistributionChart
              distribution={stats.score_distribution}
              average={stats.summary.average_score}
              tooltip="Your score distribution across all rated VNs. The highlighted bar shows the score closest to your average. Hover over bars to see counts."
            />
            <ReleaseYearChart
              distribution={stats.release_year_distribution}
              distributionWithRatings={stats.release_year_with_ratings}
              tooltip="VNs in your list grouped by their original release year. Blue dots show your average rating for VNs from each year."
            />
            {stats.length_distribution_detailed && (
              <LengthChart
                distribution={stats.length_distribution_detailed}
                tooltip="VNs categorized by estimated playtime (Very Short: <2h, Short: 2-10h, Medium: 10-30h, Long: 30-50h, Very Long: >50h). Blue dots show your average rating for each length."
              />
            )}
            {stats.age_rating_distribution && (
              <AgeRatingChart
                distribution={stats.age_rating_distribution}
                tooltip="VNs grouped by content rating. All Ages (0-12), Teen (13-17), and Adult (18+). Blue dots show your average rating for each category."
              />
            )}
          </div>
          ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none text-center mb-8">
            <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 dark:text-gray-400 mb-1">
              No completed VNs found on this user&apos;s VNDB list.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">
              Stats will appear once VNs are marked as &quot;Finished&quot; on VNDB.
            </p>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-700 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
            </button>
          </div>
          )}
          </TabPanel>

          {/* Trends Tab */}
          <TabPanel active={activeTab === 'trends'} mounted={mountedTabs.has('trends')}>
          {isLoadingNovels || novels === null ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-6 h-6 animate-spin text-primary-500" />
                <span className="ml-2 text-gray-500 dark:text-gray-400">Loading trends data...</span>
              </div>
            </div>
          ) : (
            <TrendsSection
              monthlyActivity={stats.monthly_activity || []}
              novels={novels}
            />
          )}
          </TabPanel>

          {/* Novels Tab */}
          <TabPanel active={activeTab === 'novels'} mounted={mountedTabs.has('novels')}>
          {/* NovelsSection handles its own loading state with skeleton/overlay */}
          <NovelsSection novels={novels ?? []} isLoading={isLoadingNovels || novels === null} />
          {/* Show empty state only when not loading and no novels */}
          {!isLoadingNovels && novels !== null && novels.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none mt-4">
              <div className="flex items-center gap-2 mb-4">
                <BookOpen className="w-5 h-5 text-primary-500" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Visual Novels
                </h3>
              </div>
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                No visual novels found in this user&apos;s list.
              </p>
            </div>
          )}
          </TabPanel>

          {/* Tags Tab */}
          <TabPanel active={activeTab === 'tags'} mounted={mountedTabs.has('tags')}>
          {tags && tags.top_tags.length > 0 ? (
            <TagsSection tags={tags} />
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
              <div className="text-center py-8">
                <p className="text-gray-500 dark:text-gray-400 mb-2">
                  {stats.summary.total_vns > 0
                    ? "Tag analytics couldn't be loaded. Try refreshing."
                    : "No tag data available yet."}
                </p>
                {stats.summary.total_vns > 0 && (
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh Data
                  </button>
                )}
              </div>
            </div>
          )}
          </TabPanel>

          {/* Developers Tab */}
          <TabPanel active={activeTab === 'developers'} mounted={mountedTabs.has('developers')}>
            <DevelopersSection developers={stats.developers_breakdown || []} />
          </TabPanel>

          {/* Publishers Tab */}
          <TabPanel active={activeTab === 'publishers'} mounted={mountedTabs.has('publishers')}>
            <PublishersSection publishers={stats.publishers_breakdown || []} />
          </TabPanel>

          {/* Staff Tab */}
          <TabPanel active={activeTab === 'staff'} mounted={mountedTabs.has('staff')}>
            <StaffSection staff={stats.staff_breakdown || []} />
          </TabPanel>

          {/* Seiyuu Tab */}
          <TabPanel active={activeTab === 'seiyuu'} mounted={mountedTabs.has('seiyuu')}>
            <SeiyuuSection seiyuu={stats.seiyuu_breakdown || []} />
          </TabPanel>

          {/* Traits Tab */}
          <TabPanel active={activeTab === 'traits'} mounted={mountedTabs.has('traits')}>
            <TraitsSection traits={stats.traits_breakdown || []} />
          </TabPanel>

        </div>
      </div>
    </div>
  );
}

/**
 * Tab panel that stays in the DOM after first mount (display:none when inactive).
 * Avoids expensive unmount/remount of heavy components (e.g. Recharts SVG charts)
 * when switching between tabs — only CSS visibility toggles.
 */
const TabPanel = memo(function TabPanel({
  active,
  mounted = true,
  children,
}: {
  active: boolean;
  mounted?: boolean;
  children: React.ReactNode;
}) {
  if (!mounted) return null;
  return (
    <div style={{ display: active ? undefined : 'none' }}>
      {children}
    </div>
  );
});

function ErrorState({ error, uid }: { error: string | null; uid: string }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
        <AlertCircle className="w-8 h-8 text-red-500" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Unable to Load Stats
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {error || 'Something went wrong while loading the stats.'}
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href="/stats"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Try Another User
        </Link>
        <a
          href={getVNDBUserUrl(uid)}
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
