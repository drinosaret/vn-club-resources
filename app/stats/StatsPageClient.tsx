'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/components/Link';
import { Search } from 'lucide-react';
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
        router.push(`/stats/${user.uid}/?username=${encodeURIComponent(user.username)}`);
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
        <div className="mb-8 text-center">
          <h1 className="sec-title">VNDB Stats</h1>
          <p className="sec-sub">
            Analyze your visual novel reading habits and explore the database
          </p>
        </div>

        {/* No row of destination buttons here. The section navigation at the top of every
            page in this section already lists all of them, and a second copy on this page
            alone was the same set of links twice: on a narrow screen the copy had to scroll
            sideways, so it also hid what the navigation above was showing in full. */}

        {/* Search Form */}
        <form onSubmit={handleSubmit} className="mb-8">
          {/* The field and the control that submits it stand side by side rather than one
              inside the other: a target laid over the end of an input covers what is being
              typed once the field is narrow enough. Where the pair no longer fits on one
              line the control takes its own. */}
          <div className="flex flex-wrap justify-center max-w-lg mx-auto gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter your VNDB username"
              className="st-field flex-1 min-w-0 basis-56 px-4 py-3 text-base"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="st-act st-act--go disabled:cursor-not-allowed"
            >
              {isLoading ? 'Looking' : 'Look up'}
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          {error && (
            <p className="mt-3 text-center text-[color:var(--beni-text)]">{error}</p>
          )}
        </form>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
          <FeatureCard
            title="Reading Stats"
            description="Score distribution, release year trends, and reading activity"
          />
          <FeatureCard
            title="Recommendations"
            description="Personalized suggestions based on your taste profile"
          />
          <Link href="/stats/compare/" className="block">
            <FeatureCard
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
        <div className="mt-10 space-y-2 text-center text-sm text-[color:var(--nezu)]">
          <p>Your VNDB list must be public for stats to be generated.</p>
          <DataFreshness
            lastImport={dataStatus?.last_import}
            vnCount={dataStatus?.vn_count}
            className="justify-center"
          />
          <p className="font-mono text-xs text-[color:var(--text-faint)]">
            Inspired by the now-defunct vnstat.net
          </p>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="st-card p-4">
      <h2 className="st-card-title mb-1">
        {title}
      </h2>
      <p className="st-card-sub">
        {description}
      </p>
    </div>
  );
}
