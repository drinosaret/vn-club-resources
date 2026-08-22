'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, BarChart3, Sparkles, Users, TrendingUp } from 'lucide-react';
import { vndbStatsApi, DataStatus } from '@/lib/vndb-stats-api';
import { DataFreshness } from '@/components/stats/DataFreshness';
import { FeaturedRanking } from '@/components/stats/FeaturedRanking';
import { TrendsHighlight } from '@/components/stats/TrendsHighlight';

export default function StatsPageClient() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);

  useEffect(() => {
    vndbStatsApi.getDataStatus().then(setDataStatus);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const user = await vndbStatsApi.lookupUser(query.trim());

      if (user) {
        router.push(`/stats/${user.uid}?username=${encodeURIComponent(user.username)}`);
      } else {
        setError(`User "${query}" not found on VNDB`);
      }
    } catch {
      setError('Failed to look up user. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary-100 dark:bg-primary-900/30 mb-4">
            <BarChart3 className="w-10 h-10 text-primary-600 dark:text-primary-400" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-3">
            VNDB Stats
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Analyze your visual novel reading habits and explore the database
          </p>
        </div>

        {/* No row of destination buttons here. The section navigation at the top of every
            page in this section already lists all of them, and a second copy on this page
            alone was the same set of links twice: on a narrow screen the copy had to scroll
            sideways, so it also hid what the navigation above was showing in full. */}

        {/* Search Form */}
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="relative max-w-lg mx-auto">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter your VNDB username"
              className="w-full px-5 py-4 pr-14 text-lg rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:border-primary-500 focus:ring-1 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400 transition-colors"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 focus:outline-2 focus:outline-offset-[-4px] focus:outline-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Search className="w-6 h-6" />
              )}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-center text-red-500 dark:text-red-400">{error}</p>
          )}
        </form>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <FeatureCard
            icon={<TrendingUp className="w-6 h-6" />}
            title="Reading Stats"
            description="Score distribution, release year trends, and reading activity"
          />
          <FeatureCard
            icon={<Sparkles className="w-6 h-6" />}
            title="Recommendations"
            description="Personalized suggestions based on your taste profile"
          />
          <Link href="/stats/compare" className="block">
            <FeatureCard
              icon={<Users className="w-6 h-6" />}
              title="Compare Lists"
              description="See how your taste compares to other readers"
            />
          </Link>
        </div>

        {/* Something to look at before a username has been entered, and the clearest place to
            show that the two sections answer different kinds of question: one states a
            standing, the other states a change. */}
        <div className="mt-10 grid gap-4 lg:grid-cols-2 text-left">
          <div className="min-w-0">
            <TrendsHighlight />
          </div>
          <div className="min-w-0">
            <FeaturedRanking />
          </div>
        </div>

        {/* Note & Data Status */}
        <div className="mt-10 text-sm text-gray-500 dark:text-gray-500 text-center space-y-2">
          <p>Your VNDB list must be public for stats to be generated.</p>
          <DataFreshness
            lastImport={dataStatus?.last_import}
            vnCount={dataStatus?.vn_count}
            className="justify-center"
          />
          <p className="text-xs text-gray-400 dark:text-gray-600">
            Inspired by the now-defunct vnstat.net
          </p>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-5 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 mb-3">
        {icon}
      </div>
      <h2 className="font-semibold text-gray-900 dark:text-white mb-1">
        {title}
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {description}
      </p>
    </div>
  );
}
