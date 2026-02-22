'use client';

import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, BarChart3, Star, Users, Globe, BookOpen, TrendingUp, RefreshCw, AlertCircle } from 'lucide-react';
import { vndbStatsApi, TopVN, GlobalStats } from '@/lib/vndb-stats-api';
import { TopVNsTable } from '@/components/stats/TopVNsTable';
import { ScoreDistributionChart } from '@/components/stats/ScoreDistributionChart';
import { ReleaseYearChart } from '@/components/stats/ReleaseYearChart';
import { LengthChart } from '@/components/stats/LengthChart';
import { AgeRatingChart } from '@/components/stats/AgeRatingChart';
import { LastUpdated } from '@/components/stats/LastUpdated';
import { FadeIn } from '@/components/FadeIn';

export default function GlobalStatsClient() {
  const [topRated, setTopRated] = useState<TopVN[]>([]);
  const [mostPopular, setMostPopular] = useState<TopVN[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshBlocked, setIsRefreshBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) setIsLoading(true);
    setError(null);

    // Use Promise.allSettled for graceful partial failure handling
    const results = await Promise.allSettled([
      vndbStatsApi.getTopVNs('rating', 10),
      vndbStatsApi.getTopVNs('votecount', 10),
      vndbStatsApi.getGlobalStats({ nocache: forceRefresh }),
    ]);

    const [ratedResult, popularResult, statsResult] = results;

    // Handle each result independently
    if (ratedResult.status === 'fulfilled') {
      setTopRated(ratedResult.value);
    } else {
      setTopRated([]);
      console.error('Failed to load top rated VNs:', ratedResult.reason);
    }

    if (popularResult.status === 'fulfilled') {
      setMostPopular(popularResult.value);
    } else {
      setMostPopular([]);
      console.error('Failed to load most popular VNs:', popularResult.reason);
    }

    if (statsResult.status === 'fulfilled') {
      setGlobalStats(statsResult.value);
    } else {
      setGlobalStats(null);
      console.error('Failed to load global stats:', statsResult.reason);
    }

    // Show error only if all requests failed
    const allFailed = results.every(r => r.status === 'rejected');
    if (allFailed) {
      setError('Failed to connect to the backend service. Please ensure the stats backend is running.');
    } else if (results.some(r => r.status === 'rejected')) {
      // Partial failure - some data loaded
      setError('Some data failed to load. Partial results are shown.');
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    if (isRefreshBlocked || isRefreshing) return;
    setIsRefreshing(true);
    setIsRefreshBlocked(true);
    await loadData(true);
    setIsRefreshing(false);
    // Block refresh for 8 seconds after completion
    setTimeout(() => setIsRefreshBlocked(false), 8000);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => window.history.back()}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Globe className="w-6 h-6 text-primary-500" />
              Global VNDB Stats
              <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-sm bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
                BETA
              </span>
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Top visual novels across the entire database
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isRefreshBlocked}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh data'}
          </button>
          <LastUpdated timestamp={globalStats?.last_updated} />
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">{error}</p>
            </div>
            <button
              onClick={() => loadData()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Skeleton Loading State */}
      {isLoading && (
        <div className="space-y-8">
          {/* Top VNs Skeleton */}
          <div>
            <div className="h-6 w-40 bg-gray-200 dark:bg-gray-700 rounded-sm mb-4 image-placeholder" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {[0, 1].map((i) => (
                <div key={i} className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                  <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded-sm mb-4 image-placeholder" />
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <div key={j} className="flex items-center gap-3">
                        <div className="w-10 h-14 bg-gray-200 dark:bg-gray-700 rounded-sm image-placeholder" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-sm w-3/4 image-placeholder" />
                          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-sm w-1/2 image-placeholder" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Stats Cards Skeleton */}
          <div>
            <div className="h-6 w-40 bg-gray-200 dark:bg-gray-700 rounded-sm mb-4 image-placeholder" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                  <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded-sm mb-3 image-placeholder" />
                  <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded-sm image-placeholder" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Content with fade-in transitions */}
      {!isLoading && (
        <>
          {/* Top Visual Novels Section */}
          <FadeIn delay={0}>
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Top Visual Novels
              </h2>
              {topRated.length === 0 && mostPopular.length === 0 ? (
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-6 border border-gray-100 dark:border-gray-700">
                  <div className="flex items-start gap-3">
                    <BarChart3 className="w-6 h-6 text-gray-400 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-white mb-1">
                        Top lists unavailable
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        The backend didn&apos;t return the top VN lists. Try &quot;Refresh data&quot;, or check the backend logs if this persists.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <TopVNsTable
                    title="Highest Rated"
                    vns={topRated}
                    icon={<Star className="w-5 h-5 text-yellow-500" />}
                    showVotes={true}
                    showRating={true}
                  />
                  <TopVNsTable
                    title="Most Popular"
                    vns={mostPopular}
                    icon={<Users className="w-5 h-5 text-blue-500" />}
                    showVotes={true}
                    showRating={true}
                  />
                </div>
              )}
            </div>
          </FadeIn>

          {/* Global Stats Summary */}
          {globalStats && (
            <FadeIn delay={100}>
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Database Overview
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-2 mb-2">
                      <BookOpen className="w-4 h-4 text-primary-500" />
                      <span className="text-xs text-gray-500 dark:text-gray-400">Total VNs</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {globalStats.total_vns.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-2 mb-2">
                      <Star className="w-4 h-4 text-yellow-500" />
                      <span className="text-xs text-gray-500 dark:text-gray-400">With Ratings</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {globalStats.total_with_ratings.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-4 h-4 text-green-500" />
                      <span className="text-xs text-gray-500 dark:text-gray-400">Average Rating</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {globalStats.average_rating.toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="w-4 h-4 text-blue-500" />
                      <span className="text-xs text-gray-500 dark:text-gray-400">Rating %</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {((globalStats.total_with_ratings / globalStats.total_vns) * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </FadeIn>
          )}

          {/* Distribution Charts */}
          {globalStats && (
            <FadeIn delay={200}>
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Distribution Charts
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {globalStats.score_distribution && (
                    <ScoreDistributionChart
                      distribution={globalStats.score_distribution}
                      average={globalStats.average_rating}
                    />
                  )}
                  {globalStats.release_year_distribution && (
                    <ReleaseYearChart
                      distribution={globalStats.release_year_distribution}
                      distributionWithRatings={globalStats.release_year_with_ratings}
                    />
                  )}
                  {globalStats.length_distribution && (
                    <LengthChart distribution={globalStats.length_distribution} />
                  )}
                  {globalStats.age_rating_distribution && (
                    <AgeRatingChart distribution={globalStats.age_rating_distribution} />
                  )}
                </div>
              </div>
            </FadeIn>
          )}

          {/* Fallback message if no global stats */}
          {!globalStats && (
            <FadeIn delay={100}>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-6 border border-gray-100 dark:border-gray-700">
                <div className="flex items-start gap-3">
                  <BarChart3 className="w-6 h-6 text-gray-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white mb-1">
                      Distribution Charts Unavailable
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      The backend service is not available. Distribution charts require
                      the backend to process aggregated statistics from the VNDB data dumps.
                    </p>
                  </div>
                </div>
              </div>
            </FadeIn>
          )}
        </>
      )}
    </div>
  );
}
