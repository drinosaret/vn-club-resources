'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, BarChart3, Sparkles, Users, TrendingUp, Globe, Database } from 'lucide-react';
import { vndbStatsApi, DataStatus } from '@/lib/vndb-stats-api';

export default function StatsPage() {
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
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary-100 dark:bg-primary-900/30 mb-4">
            <BarChart3 className="w-10 h-10 text-primary-600 dark:text-primary-400" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-3 flex items-center justify-center gap-3">
            VNDB Stats
            <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
              BETA
            </span>
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Analyze your visual novel reading habits and explore the database
          </p>
          <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
            This feature is in beta. Expect bugs and missing data. Feedback welcome!
          </p>
        </div>

        {/* Navigation Links */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
          <Link
            href="/stats/global"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
          >
            <Globe className="w-4 h-4" />
            Global Stats
          </Link>
          <Link
            href="/stats/compare"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
          >
            <Users className="w-4 h-4" />
            Compare
          </Link>
          <Link
            href="/recommendations"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            Recommendations
          </Link>
        </div>

        {/* Recommendations Link removed (now a tab above) */}

        {/* Search Form */}
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="relative max-w-lg mx-auto">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter your VNDB username"
              className="w-full px-5 py-4 pr-14 text-lg rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 dark:focus:border-primary-400 transition-colors"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left max-w-2xl mx-auto">
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

        {/* Note & Data Status */}
        <div className="mt-10 text-sm text-gray-500 dark:text-gray-500 text-center space-y-2">
          <p>Your VNDB list must be public for stats to be generated.</p>
          {dataStatus?.last_import && (
            <p className="flex items-center justify-center gap-1.5 text-xs">
              <Database className="w-3.5 h-3.5" />
              Data last updated: {formatLastUpdate(dataStatus.last_import)}
              {dataStatus.next_update && (
                <span className="text-gray-400">· Next update {formatTimeUntil(dataStatus.next_update)}</span>
              )}
              {dataStatus.vn_count && (
                <span className="text-gray-400">({dataStatus.vn_count.toLocaleString()} VNs)</span>
              )}
            </p>
          )}
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
      <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
        {title}
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {description}
      </p>
    </div>
  );
}

function formatLastUpdate(isoDate: string): string {
  // Backend may return timestamps with +00:00 offset, Z suffix, or no timezone
  const hasTimezone = /[Zz]$/.test(isoDate) || /[+-]\d{2}:\d{2}$/.test(isoDate);
  const normalizedDate = hasTimezone ? isoDate : isoDate + 'Z';
  const date = new Date(normalizedDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) {
    return 'just now';
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

function formatTimeUntil(isoDate: string): string {
  // Backend may return timestamps with +00:00 offset, Z suffix, or no timezone
  const hasTimezone = /[Zz]$/.test(isoDate) || /[+-]\d{2}:\d{2}$/.test(isoDate);
  const normalizedDate = hasTimezone ? isoDate : isoDate + 'Z';
  const date = new Date(normalizedDate);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs <= 0) {
    return 'soon';
  }

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const remainingMinutes = diffMinutes % 60;

  if (diffHours < 1) {
    return `in ${diffMinutes} min`;
  } else if (diffHours < 24) {
    return remainingMinutes > 0
      ? `in ${diffHours}h ${remainingMinutes}m`
      : `in ${diffHours}h`;
  } else {
    const diffDays = Math.floor(diffHours / 24);
    const remainingHours = diffHours % 24;
    return remainingHours > 0
      ? `in ${diffDays}d ${remainingHours}h`
      : `in ${diffDays}d`;
  }
}
