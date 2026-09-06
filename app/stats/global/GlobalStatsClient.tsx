'use client';

import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { vndbStatsApi, TopVN, GlobalStats } from '@/lib/vndb-stats-api';
import { TopVNsTable } from '@/components/stats/TopVNsTable';
import { ScoreDistributionChart } from '@/components/stats/ScoreDistributionChart';
import { ReleaseYearChart } from '@/components/stats/ReleaseYearChart';
import { LengthChart } from '@/components/stats/LengthChart';
import { AgeRatingChart } from '@/components/stats/AgeRatingChart';
import { LastUpdated } from '@/components/stats/LastUpdated';
import { DataFreshness } from '@/components/stats/DataFreshness';
import { VoteActivitySection } from '@/components/stats/global/VoteActivitySection';
import { ReleaseTimelineSection } from '@/components/stats/global/ReleaseTimelineSection';
import { ReadingTrendsSection } from '@/components/stats/global/ReadingTrendsSection';
import { DatabaseGrowthSection } from '@/components/stats/global/DatabaseGrowthSection';
import { FadeIn } from '@/components/FadeIn';
import { StatsCrossLinks } from '@/components/stats/StatsCrossLinks';

export default function GlobalStatsClient() {
  const [topRated, setTopRated] = useState<TopVN[]>([]);
  const [mostPopular, setMostPopular] = useState<TopVN[]>([]);
  // Ranked separately rather than filtered from the lists above: filtering a fixed-length
  // list down to its Japanese-original entries leaves however many happen to survive, which
  // is not a top ten of anything.
  const [topRatedJa, setTopRatedJa] = useState<TopVN[]>([]);
  const [mostPopularJa, setMostPopularJa] = useState<TopVN[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshBlocked, setIsRefreshBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dumpDate, setDumpDate] = useState<string | null>(null);

  useEffect(() => {
    vndbStatsApi.getLeaderboardCatalogue().then((catalogue) => {
      if (catalogue?.dump_date) setDumpDate(catalogue.dump_date);
    });
  }, []);

  const loadData = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) setIsLoading(true);
    setError(null);

    // Use Promise.allSettled for graceful partial failure handling
    const results = await Promise.allSettled([
      vndbStatsApi.getTopVNs('rating', 10),
      vndbStatsApi.getTopVNs('votecount', 10),
      vndbStatsApi.getGlobalStats({ nocache: forceRefresh }),
      vndbStatsApi.getTopVNs('rating', 10, 'ja'),
      vndbStatsApi.getTopVNs('votecount', 10, 'ja'),
    ]);

    const [ratedResult, popularResult, statsResult, ratedJaResult, popularJaResult] = results;

    setTopRatedJa(ratedJaResult.status === 'fulfilled' ? ratedJaResult.value : []);
    setMostPopularJa(popularJaResult.status === 'fulfilled' ? popularJaResult.value : []);

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
            aria-label="Go back"
            className="st-act st-act--icon"
          >
            <ArrowLeft className="w-5 h-5 text-[color:var(--nezu)]" />
          </button>
          <div>
            <h1 className="sec-title">Global VNDB Stats</h1>
            <p className="sec-sub">
              The shape of the database as it stands. For what is moving, see trends.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isRefreshBlocked}
            className="st-act disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh data'}
          </button>
          <LastUpdated timestamp={globalStats?.last_updated} />
        </div>
      </div>

      {/* The dump the figures come from, not the last time a row was written. The importer
          stamps updated_at on every row it touches, so that clock runs months ahead of the
          data and disagreed with the same line on the rankings pages. */}
      <DataFreshness dumpDate={dumpDate} className="mb-6" />

      {/* Error Banner */}
      {error && (
        <div className="st-note mb-6 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[color:var(--beni-text)]">{error}</p>
            </div>
            <button
              onClick={() => loadData()}
              className="st-act shrink-0"
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
            <div className="h-6 w-40 rounded-xs image-placeholder" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {[0, 1].map((i) => (
                <div key={i} className="st-card p-4">
                  <div className="h-5 w-32 rounded-xs image-placeholder" />
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <div key={j} className="flex items-center gap-3">
                        <div className="w-10 h-14 rounded-xs image-placeholder" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 rounded-xs image-placeholder" />
                          <div className="h-3 rounded-xs image-placeholder" />
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
            <div className="h-6 w-40 rounded-xs image-placeholder" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="st-card p-4">
                  <div className="h-4 w-20 rounded-xs image-placeholder" />
                  <div className="h-8 w-24 rounded-xs image-placeholder" />
                </div>
              ))}
            </div>
          </div>

          {/* The chart sections, which are the bulk of this page. Covering only the two blocks
              above left the page a third of its loaded height, so everything below the fold
              travelled when the data arrived. */}
          {[0, 1, 2, 3].map((i) => (
            <div key={`section-${i}`}>
              <div className="h-6 w-48 rounded-xs image-placeholder" />
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="image-placeholder h-64 rounded-xs" />
                <div className="image-placeholder h-64 rounded-xs" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Content with fade-in transitions */}
      {!isLoading && (
        <>
          {/* Top Visual Novels Section */}
          <FadeIn delay={0}>
            <div className="mb-8">
              <h2 className="sec-title mb-4">Top Visual Novels</h2>
              {topRated.length === 0 && mostPopular.length === 0 ? (
                <div className="st-card p-6">
                  <div className="flex items-start gap-3">
                    <div>
                      <h3 className="st-card-title mb-1">
                        Top lists unavailable
                      </h3>
                      <p className="text-sm text-[color:var(--nezu)]">
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
                    japaneseVns={topRatedJa}
                    showVotes={true}
                    showRating={true}
                  />
                  <TopVNsTable
                    title="Most Popular"
                    vns={mostPopular}
                    japaneseVns={mostPopularJa}
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
                <h2 className="sec-title mb-4">Database Overview</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  <div className="st-card p-4">
                    <span className="fig-label">Total VNs</span>
                    <span className="fig-value">{globalStats.total_vns.toLocaleString()}</span>
                  </div>
                  <div className="st-card p-4">
                    <span className="fig-label">With ratings</span>
                    <span className="fig-value">
                      {globalStats.total_with_ratings.toLocaleString()}
                    </span>
                  </div>
                  <div className="st-card p-4">
                    <span className="fig-label">Average rating</span>
                    <span className="fig-value">{globalStats.average_rating.toFixed(2)}</span>
                  </div>
                  <div className="st-card p-4">
                    <span className="fig-label">Rating %</span>
                    <span className="fig-value">
                      {((globalStats.total_with_ratings / globalStats.total_vns) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </FadeIn>
          )}

          {/* Distribution Charts */}
          {globalStats && (
            <FadeIn delay={200}>
              <div className="mb-8">
                <h2 className="sec-title mb-4">Distribution Charts</h2>
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

          {/* These key on when a vote was cast, a title was released, or an entry was
              catalogued, which are all facts about the database itself. How the community's
              reading has shifted is a fact about its readers, and lives with the trends. */}
          <FadeIn delay={150}>
            <section className="mt-10">
              <h2 className="sec-title">
                When people read
              </h2>
              <p className="sec-sub mb-5">
                These key on when votes were cast rather than when titles came out, so they
                describe the community rather than the medium.
              </p>
              <VoteActivitySection />
            </section>
          </FadeIn>

          <FadeIn delay={170}>
            <section className="mt-10">
              <h2 className="sec-title">
                How far back people read
              </h2>
              <p className="sec-sub mb-5">
                Keyed on when a vote was cast against when its title came out. This describes
                the audience rather than the medium, and it has moved a long way.
              </p>
              <ReadingTrendsSection />
            </section>
          </FadeIn>

          <FadeIn delay={175}>
            <section className="mt-10">
              <h2 className="sec-title">
                What was published
              </h2>
              <p className="sec-sub mb-5">
                Keyed on the year a title was first released.
              </p>
              <ReleaseTimelineSection />
            </section>
          </FadeIn>

          <FadeIn delay={200}>
            <section className="mt-10">
              <h2 className="sec-title">
                How the record was built
              </h2>
              <p className="sec-sub mb-5">
                Keyed on when an entry was catalogued, which is a fact about the editors
                rather than about the games.
              </p>
              <DatabaseGrowthSection />
            </section>
          </FadeIn>

          {/* Fallback message if no global stats */}
          {!globalStats && (
            <FadeIn delay={100}>
              <div className="st-card p-6">
                <div className="flex items-start gap-3">
                  <div>
                    <h3 className="st-card-title mb-1">
                      Distribution Charts Unavailable
                    </h3>
                    <p className="text-sm text-[color:var(--nezu)]">
                      The backend service is not available. Distribution charts require
                      the backend to process aggregated statistics from the VNDB data dumps.
                    </p>
                  </div>
                </div>
              </div>
            </FadeIn>
          )}

          <StatsCrossLinks current="global" />
        </>
      )}
    </div>
  );
}
