'use client';

import { useState, useMemo } from 'react';
import Link from '@/components/Link';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import type { ProducerBreakdown } from '@/lib/vndb-stats-api';
import { useTitlePreference, getEntityDisplayName } from '@/lib/title-preference';
import { RankNumber } from '@/components/stats/RankNumber';

interface DevelopersSectionProps {
  developers: ProducerBreakdown[];
}

type SortMode = 'weighted' | 'count' | 'rating';

interface DeveloperWithNormalizedScores extends ProducerBreakdown {
  normalized_score: number;  // weighted_score normalized to 0-100 for display
}

const TYPE_LABELS: Record<string, string> = {
  co: 'Company',
  in: 'Individual',
  ng: 'Group',
};

export function DevelopersSection({ developers }: DevelopersSectionProps) {
  const [sortMode, setSortMode] = useState<SortMode>('weighted');
  const [showAll, setShowAll] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const { preference } = useTitlePreference();

  // Extract unique types and filter developers
  const { types, filteredDevelopers } = useMemo(() => {
    const typeSet = new Set(developers.map(d => d.type).filter(Boolean) as string[]);
    const types = Array.from(typeSet).sort();

    const filtered = typeFilter === 'all'
      ? developers
      : developers.filter(d => d.type === typeFilter);

    return { types, filteredDevelopers: filtered };
  }, [developers, typeFilter]);

  // Use backend weighted_score and normalize so top is 100 for display
  const developersWithScores = useMemo((): DeveloperWithNormalizedScores[] => {
    // Get max weighted_score from backend (for normalization)
    const maxScore = Math.max(...filteredDevelopers.map(d => d.weighted_score ?? 0), 1);
    return filteredDevelopers.map(dev => ({
      ...dev,
      normalized_score: ((dev.weighted_score ?? 0) / maxScore) * 100,
    }));
  }, [filteredDevelopers]);

  // Calculate taste preferences (developers user rates higher/lower than VNDB average)
  const preferences = useMemo(() => {
    const loved: Array<{id: string; name: string; original?: string | null; user_avg: number; global_avg: number}> = [];
    const avoided: Array<{id: string; name: string; original?: string | null; user_avg: number; global_avg: number}> = [];

    for (const dev of developers) {
      if (dev.avg_rating > 0 && dev.global_avg_rating != null && dev.count >= 3) {
        const diff = dev.avg_rating - dev.global_avg_rating;
        const pref = {
          id: dev.id,
          name: dev.name,
          original: dev.original,
          user_avg: dev.avg_rating,
          global_avg: dev.global_avg_rating,
        };
        if (diff > 0.5) {
          loved.push(pref);
        } else if (diff < -0.5) {
          avoided.push(pref);
        }
      }
    }

    loved.sort((a, b) => (b.user_avg - b.global_avg) - (a.user_avg - a.global_avg));
    avoided.sort((a, b) => (a.global_avg - a.user_avg) - (b.global_avg - b.user_avg));

    return { loved: loved.slice(0, 10), avoided: avoided.slice(0, 10) };
  }, [developers]);

  // Sort developers based on selected mode
  const sortedDevelopers = useMemo(() => {
    const devsCopy = [...developersWithScores];
    switch (sortMode) {
      case 'weighted':
        return devsCopy.sort((a, b) => {
          if (b.normalized_score !== a.normalized_score) return b.normalized_score - a.normalized_score;
          return b.count - a.count;
        });
      case 'count':
        return devsCopy.sort((a, b) => b.count - a.count);
      case 'rating':
        return devsCopy.sort((a, b) => {
          if (b.avg_rating !== a.avg_rating) return b.avg_rating - a.avg_rating;
          return b.count - a.count;
        });
      default:
        return devsCopy;
    }
  }, [developersWithScores, sortMode]);

  const displayedDevelopers = showAll ? sortedDevelopers : sortedDevelopers.slice(0, 10);

  // Calculate max value for bar width
  const maxValue = useMemo(() => {
    switch (sortMode) {
      case 'weighted':
        return 100; // Weighted scores are 0-100
      case 'count':
        return Math.max(...developersWithScores.map(d => d.count), 1);
      case 'rating':
        return 10;
      default:
        return 100;
    }
  }, [developersWithScores, sortMode]);

  if (developers.length === 0) {
    return (
      <div className="st-card p-6">
        <div className="mb-4">
          <h3 className="st-card-title">
            Developers
          </h3>
        </div>
        <p className="st-card-sub py-8 text-center">
          No developer information found for your VNs.
        </p>
      </div>
    );
  }

  return (
    <div className="st-card p-6">
      <div className="st-card-head mb-4">
        <div className="flex items-center gap-2">
          <h3 className="st-card-title">
            Top Developers
          </h3>
        </div>

        {/* Sort toggle */}
        <div className="flex items-center gap-1 text-sm">
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="st-select px-2 py-1 text-xs"
          >
            <option value="weighted">Weighted</option>
            <option value="count">Count</option>
            <option value="rating">Rating</option>
          </select>
          {sortMode === 'weighted' && (
            <div className="relative group" tabIndex={0} role="button" aria-label="Weighted score info">
              <Info className="w-4 h-4 text-[color:var(--text-faint)] cursor-help" />
              <div className="absolute right-0 top-6 w-64 p-2 st-tip on-box opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all z-50">
                <p className="fig-label mb-1">Weighted Score</p>
                <p>Ranks by your ratings, with low-count entries pulled toward your personal average to prevent single-VN flukes from dominating.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Type filter - horizontally scrollable on mobile */}
      {types.length > 1 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-none">
          <button
            onClick={() => setTypeFilter('all')}
            className={`tab shrink-0 ${typeFilter === 'all' ? 'tab--on' : ''}`}
          >
            All
          </button>
          {types.map(type => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`tab shrink-0 ${typeFilter === type ? 'tab--on' : ''}`}
            >
              {TYPE_LABELS[type] || type}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3" style={showAll ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 500px' } : undefined}>
        {displayedDevelopers.map((dev, index) => (
          <DeveloperBar key={dev.id} rank={index + 1} developer={dev} maxValue={maxValue} sortMode={sortMode} preference={preference} />
        ))}
      </div>

      {sortedDevelopers.length > 10 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="st-act mt-4 w-full"
        >
          {showAll ? (
            <>
              Show Less <ChevronUp className="w-4 h-4" />
            </>
          ) : (
            <>
              Show All ({sortedDevelopers.length}) <ChevronDown className="w-4 h-4" />
            </>
          )}
        </button>
      )}

      {/* Taste Analysis */}
      {(preferences.loved.length > 0 || preferences.avoided.length > 0) && (
        <div className="mt-6 pt-6 border-t border-[color:var(--rule)]">
          <h4 className="fig-label mb-3">
            Taste Analysis
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {preferences.loved.length > 0 && (
              <div>
                <p className="st-card-sub mb-2">
                  You rate higher than average:
                </p>
                <div className="flex flex-wrap gap-2">
                  {preferences.loved.slice(0, 5).map((pref) => (
                    <Link
                      key={pref.id}
                      href={`/stats/producer/${pref.id}`}
                      className="st-chip"
                    >
                      {getEntityDisplayName(pref, preference)}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {preferences.avoided.length > 0 && (
              <div>
                <p className="st-card-sub mb-2">
                  You rate lower than average:
                </p>
                <div className="flex flex-wrap gap-2">
                  {preferences.avoided.slice(0, 5).map((pref) => (
                    <Link
                      key={pref.id}
                      href={`/stats/producer/${pref.id}`}
                      className="st-chip st-chip--low"
                    >
                      {getEntityDisplayName(pref, preference)}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DeveloperBar({ rank, developer, maxValue, sortMode, preference }: { rank: number; developer: DeveloperWithNormalizedScores; maxValue: number; sortMode: SortMode; preference: 'romaji' | 'japanese' }) {
  const displayName = getEntityDisplayName(developer, preference);

  // Calculate bar width based on sort mode
  let barValue: number;
  switch (sortMode) {
    case 'weighted':
      barValue = developer.normalized_score;
      break;
    case 'count':
      barValue = developer.count;
      break;
    case 'rating':
      barValue = developer.avg_rating;
      break;
    default:
      barValue = developer.normalized_score;
  }
  const width = (barValue / maxValue) * 100;

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <RankNumber rank={rank} />
          <Link
            href={`/stats/producer/${developer.id}`}
            className="dg-name"
          >
            {displayName}
          </Link>
          {/* Hide type badge on mobile */}
          {developer.type && (
            <span className="hidden sm:inline text-xs text-[color:var(--text-faint)] shrink-0">
              {developer.type === 'co' ? 'Company' : developer.type === 'in' ? 'Individual' : 'Group'}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs sm:gap-3">
          {/* On mobile: only show primary metric. On desktop: show all */}
          <Link
            href={`/browse?developer=${encodeURIComponent(developer.id)}&tag_names=${encodeURIComponent(`developer:${developer.id}:${displayName}`)}`}
            className={`${sortMode === 'count' ? '' : 'hidden sm:inline-flex'} hover:text-[color:var(--ai)] transition-colors inline-flex items-center gap-1 ${sortMode === 'count'
              ? 'st-num text-[color:var(--ink)]'
              : 'st-num text-[color:var(--text-faint)]'}`}
            title={`Browse all VNs by ${displayName}`}
          >
            {developer.count} VNs
          </Link>
          {developer.avg_rating > 0 && (
            <span
              className={`${sortMode === 'rating' ? '' : 'hidden sm:inline'} ${sortMode === 'rating'
                ? 'st-num text-[color:var(--ink)]'
                : 'st-num text-[color:var(--text-faint)]'}`}
              title="Your average rating"
            >
              {developer.avg_rating.toFixed(1)}
            </span>
          )}
          {sortMode === 'weighted' && (
            <span
              className="st-num text-[color:var(--ink)]"
              title="Weighted score"
            >
              {developer.normalized_score.toFixed(1)}
            </span>
          )}
        </div>
      </div>
      <div className="st-bar h-2">
        <div
          className="st-bar-fill st-bar-fill--quiet"
          style={{ width: `${Math.min(100, width)}%` }}
        />
      </div>
    </div>
  );
}
