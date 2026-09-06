'use client';

import { useState, useMemo, useLayoutEffect } from 'react';
import Link from '@/components/Link';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import type { TraitBreakdown } from '@/lib/vndb-stats-api';
import { RankNumber } from '@/components/stats/RankNumber';

interface TraitsSectionProps {
  traits: TraitBreakdown[];
}

type SortMode = 'weighted' | 'rating' | 'count' | 'characters';

interface TraitWithNormalizedScores extends TraitBreakdown {
  normalized_score: number;  // weighted_score normalized to 0-100 for display
}

export function TraitsSection({ traits }: TraitsSectionProps) {
  const [sortMode, setSortMode] = useState<SortMode>('weighted');
  const [showAll, setShowAll] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>('all');
  // Delay list rendering to prevent flash of unsorted content
  // useLayoutEffect runs before browser paint, preventing visual flash
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => setMounted(true), []);

  // Process all trait data in a single memo to prevent flash of unsorted content
  // Combines: normalization, filtering, sorting, and display slicing
  const { groups, sortedTraits, displayedTraits, preferences } = useMemo(() => {
    // Extract unique groups
    const groupSet = new Set(traits.map(t => t.group_name).filter(Boolean) as string[]);
    const groups = Array.from(groupSet).sort();

    // Normalize scores (top weighted_score becomes 100)
    const maxScore = Math.max(...traits.map(t => t.weighted_score ?? 0), 1);
    const withScores: TraitWithNormalizedScores[] = traits.map(trait => ({
      ...trait,
      normalized_score: ((trait.weighted_score ?? 0) / maxScore) * 100,
    }));

    // Filter by group
    const filtered = groupFilter === 'all'
      ? withScores
      : withScores.filter(t => t.group_name === groupFilter);

    // Sort based on mode
    const sorted = [...filtered];
    switch (sortMode) {
      case 'weighted':
        sorted.sort((a, b) => {
          if (b.normalized_score !== a.normalized_score) return b.normalized_score - a.normalized_score;
          return b.vn_count - a.vn_count;
        });
        break;
      case 'rating':
        sorted.sort((a, b) => {
          const aRating = a.avg_rating ?? 0;
          const bRating = b.avg_rating ?? 0;
          if (bRating !== aRating) return bRating - aRating;
          return b.vn_count - a.vn_count;
        });
        break;
      case 'count':
        sorted.sort((a, b) => b.vn_count - a.vn_count);
        break;
      case 'characters':
        sorted.sort((a, b) => b.count - a.count);
        break;
    }

    // Calculate taste preferences
    const loved: Array<{id: number; name: string; user_avg: number; global_avg: number}> = [];
    const avoided: Array<{id: number; name: string; user_avg: number; global_avg: number}> = [];

    for (const trait of traits) {
      if (trait.avg_rating != null && trait.avg_rating > 0 &&
          trait.global_avg_rating != null && trait.vn_count >= 3) {
        const diff = trait.avg_rating - trait.global_avg_rating;
        const pref = {
          id: trait.id,
          name: trait.name,
          user_avg: trait.avg_rating,
          global_avg: trait.global_avg_rating,
        };
        if (diff > 0.5) loved.push(pref);
        else if (diff < -0.5) avoided.push(pref);
      }
    }

    loved.sort((a, b) => (b.user_avg - b.global_avg) - (a.user_avg - a.global_avg));
    avoided.sort((a, b) => (a.global_avg - a.user_avg) - (b.global_avg - b.user_avg));

    return {
      groups,
      sortedTraits: sorted,
      displayedTraits: showAll ? sorted : sorted.slice(0, 10),
      preferences: { loved: loved.slice(0, 10), avoided: avoided.slice(0, 10) },
    };
  }, [traits, groupFilter, sortMode, showAll]);

  // Calculate max value for bar width
  const maxValue = useMemo(() => {
    switch (sortMode) {
      case 'weighted':
        return Math.max(...sortedTraits.map(t => t.normalized_score), 1);
      case 'rating':
        return 10; // Rating is 0-10
      case 'count':
        return Math.max(...sortedTraits.map(t => t.vn_count), 1);
      case 'characters':
        return Math.max(...sortedTraits.map(t => t.count), 1);
      default:
        return 100;
    }
  }, [sortedTraits, sortMode]);

  if (traits.length === 0) {
    return (
      <div className="st-card p-6">
        <div className="mb-4">
          <h3 className="st-card-title">
            Character Traits
          </h3>
        </div>
        <p className="st-card-sub py-8 text-center">
          No character trait data found for your VNs.
        </p>
      </div>
    );
  }

  return (
    <div className="st-card p-6">
      <div className="st-card-head mb-4">
        <div className="flex items-center gap-2">
          <h3 className="st-card-title">
            Top Traits
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
            <option value="rating">Rating</option>
            <option value="count">Count</option>
            <option value="characters">Characters</option>
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

      {/* Group filter - horizontally scrollable on mobile */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-none">
        <button
          onClick={() => setGroupFilter('all')}
          className={`tab shrink-0 ${groupFilter === 'all' ? 'tab--on' : ''}`}
        >
          All
        </button>
        {groups.map(group => (
          <button
            key={group}
            onClick={() => setGroupFilter(group)}
            className={`tab shrink-0 ${groupFilter === group ? 'tab--on' : ''}`}
          >
            {group}
          </button>
        ))}
      </div>

      <div className="space-y-3" style={showAll ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 500px' } : undefined}>
        {mounted && displayedTraits.map((trait, index) => (
          <TraitBar key={trait.id} rank={index + 1} trait={trait} maxValue={maxValue} sortMode={sortMode} />
        ))}
      </div>

      {sortedTraits.length > 10 && (
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
              Show All ({sortedTraits.length}) <ChevronDown className="w-4 h-4" />
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
                      href={`/stats/trait/i${pref.id}`}
                      className="st-chip"
                    >
                      {pref.name}
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
                      href={`/stats/trait/i${pref.id}`}
                      className="st-chip st-chip--low"
                    >
                      {pref.name}
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

function TraitBar({ rank, trait, maxValue, sortMode }: { rank: number; trait: TraitWithNormalizedScores; maxValue: number; sortMode: SortMode }) {
  // Calculate bar width based on sort mode
  let barValue: number;
  switch (sortMode) {
    case 'weighted':
      barValue = trait.normalized_score;
      break;
    case 'rating':
      barValue = trait.avg_rating ?? 0;
      break;
    case 'count':
      barValue = trait.vn_count;
      break;
    case 'characters':
      barValue = trait.count;
      break;
    default:
      barValue = trait.normalized_score;
  }
  const width = (barValue / maxValue) * 100;

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <RankNumber rank={rank} />
          <Link
            href={`/stats/trait/i${trait.id}`}
            className="dg-name"
          >
            {trait.name}
          </Link>
          {/* Hide group badge on mobile */}
          {trait.group_name && (
            <span className="st-badge st-badge--wide-only shrink-0">
              {trait.group_name}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs sm:gap-3">
          {/* On mobile: only show primary metric. On desktop: show all */}
          <span
            className={`${sortMode === 'count' ? '' : 'hidden sm:inline'} ${sortMode === 'count'
              ? 'st-num text-[color:var(--ink)]'
              : 'st-num text-[color:var(--text-faint)]'}`}
            title="VN count"
          >
            {trait.vn_count} VNs
          </span>
          <span
            className={`${sortMode === 'characters' ? '' : 'hidden sm:inline'} ${sortMode === 'characters'
              ? 'st-num text-[color:var(--ink)]'
              : 'st-num text-[color:var(--text-faint)]'}`}
            title="Character count"
          >
            {trait.count} chars
          </span>
          {trait.avg_rating != null && trait.avg_rating > 0 && (
            <span
              className={`${sortMode === 'rating' ? '' : 'hidden sm:inline'} ${sortMode === 'rating'
                ? 'st-num text-[color:var(--ink)]'
                : 'st-num text-[color:var(--text-faint)]'}`}
              title="Your average rating"
            >
              {trait.avg_rating.toFixed(1)}
            </span>
          )}
          {sortMode === 'weighted' && (
            <span
              className="st-num text-[color:var(--ink)]"
              title="Weighted score"
            >
              {trait.normalized_score.toFixed(1)}
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
