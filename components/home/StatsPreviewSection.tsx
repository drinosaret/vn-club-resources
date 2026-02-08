'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search, TrendingUp, Sparkles, Users, ArrowRight } from 'lucide-react';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import { MiniScoreChart } from './MiniScoreChart';
import { MiniReleaseYearChart } from './MiniReleaseYearChart';
import {
  sampleScoreDistribution,
  sampleReleaseYearDistribution,
  sampleSummary,
} from '@/lib/sample-stats-data';
import Link from 'next/link';

export function StatsPreviewSection() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const user = await vndbStatsApi.lookupUser(username.trim());

      if (user) {
        router.push(`/stats/${user.uid}?username=${encodeURIComponent(user.username)}`);
      } else {
        setError(`User "${username}" not found on VNDB`);
      }
    } catch {
      setError('Failed to look up user. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="py-20 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Section Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Discover Your Reading Stats
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Analyze your visual novel reading habits and get personalized recommendations based on your VNDB profile.
          </p>
        </div>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-2 gap-8 items-start">
          {/* Left: Search + Demo Charts */}
          <div className="space-y-6">
            {/* Search Form Card */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-lg">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Look up your stats
              </h3>
              <form onSubmit={handleSubmit}>
                <div className="relative">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your VNDB username"
                    className="w-full px-5 py-4 pr-14 text-base rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 dark:focus:border-primary-400 transition-colors"
                    disabled={isLoading}
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !username.trim()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Search className="w-5 h-5" />
                    )}
                  </button>
                </div>
                {error && (
                  <p className="mt-3 text-sm text-red-500 dark:text-red-400">{error}</p>
                )}
              </form>
              <p className="mt-3 text-xs text-gray-500 dark:text-gray-500">
                Your VNDB list must be public for stats to be generated.
              </p>
            </div>

            {/* Demo Charts */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Sample Preview
                </h3>
                <span className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                  Demo Data
                </span>
              </div>

              {/* Stats Summary */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    {sampleSummary.total_vns}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">VNs Read</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary-600 dark:text-primary-400">
                    {sampleSummary.average_score}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Avg Score</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    {Math.round(sampleSummary.estimated_hours / 24)}d
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Reading Time</div>
                </div>
              </div>

              {/* Mini Charts */}
              <div className="grid grid-cols-2 gap-4">
                <div className="h-32">
                  <MiniScoreChart
                    distribution={sampleScoreDistribution}
                    average={sampleSummary.average_score}
                  />
                </div>
                <div className="h-32">
                  <MiniReleaseYearChart distribution={sampleReleaseYearDistribution} />
                </div>
              </div>
            </div>
          </div>

          {/* Right: Feature Cards */}
          <div className="space-y-4">
            <StatsFeatureCard
              icon={<TrendingUp className="w-6 h-6" />}
              title="Reading Stats"
              description="Score distribution, release year trends, monthly activity over time, and length preferences."
            />
            <StatsFeatureCard
              icon={<Sparkles className="w-6 h-6" />}
              title="Personalized Recommendations"
              description="Personalized suggestions based on your taste profile and reading history."
            />
            <Link href="/stats/compare" className="block">
              <StatsFeatureCard
                icon={<Users className="w-6 h-6" />}
                title="Compare Lists"
                description="See how your taste compares to other readers and find users with similar preferences."
              />
            </Link>

            <Link
              href="/stats"
              className="group flex items-center justify-center gap-2 w-full py-4 rounded-xl bg-primary-600 text-white font-semibold hover:bg-primary-700 transition-colors"
            >
              Explore Stats Feature
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatsFeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4 p-5 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400">
        {icon}
      </div>
      <div>
        <h4 className="font-semibold text-gray-900 dark:text-white mb-1">{title}</h4>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
