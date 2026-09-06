'use client';

import { useState, useMemo } from 'react';
import Link from '@/components/Link';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import type { TagAnalytics, TagStats } from '@/lib/vndb-stats-api';
import { RankNumber } from '@/components/stats/RankNumber';

type SortMode = 'weighted' | 'count' | 'rating';

interface TagsSectionProps {
  tags: TagAnalytics;
  expanded?: boolean;
}

export function TagsSection({ tags, expanded = false }: TagsSectionProps) {
  const [showAll, setShowAll] = useState(expanded);
  const [sortMode, setSortMode] = useState<SortMode>('weighted');

  // Normalize weighted scores so top tag is always 100
  const normalizedTags = useMemo(() => {
    const maxScore = Math.max(...tags.top_tags.map(t => t.weighted_score || 0), 0.001);
    return tags.top_tags.map(tag => ({
      ...tag,
      weighted_score: ((tag.weighted_score || 0) / maxScore) * 100,
    }));
  }, [tags.top_tags]);

  // Sort tags based on selected mode
  const sortedTags = useMemo(() => {
    const tagsCopy = [...normalizedTags];
    switch (sortMode) {
      case 'weighted':
        return tagsCopy.sort((a, b) => {
          const aScore = a.weighted_score || 0;
          const bScore = b.weighted_score || 0;
          if (bScore !== aScore) return bScore - aScore;
          return b.count - a.count;
        });
      case 'count':
        return tagsCopy.sort((a, b) => b.count - a.count);
      case 'rating':
        return tagsCopy.sort((a, b) => {
          if (b.avg_score !== a.avg_score) return b.avg_score - a.avg_score;
          return b.count - a.count;
        });
      default:
        return tagsCopy;
    }
  }, [normalizedTags, sortMode]);

  const displayTags = showAll ? sortedTags : sortedTags.slice(0, 10);

  // Calculate max value based on sort mode for bar width
  const maxValue = useMemo(() => {
    switch (sortMode) {
      case 'weighted':
        return 100; // Weighted scores are normalized to 0-100
      case 'count':
        return Math.max(...normalizedTags.map((t) => t.count), 1);
      case 'rating':
        return 10; // Ratings are 0-10
      default:
        return 100;
    }
  }, [normalizedTags, sortMode]);

  return (
    <div className="st-card p-6">
      <div className="st-card-head mb-4">
        <div className="flex items-center gap-2">
          <h3 className="st-card-title">
            Top Tags
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

      <div className="space-y-3" style={showAll ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 500px' } : undefined}>
        {displayTags.map((tag, index) => (
          <TagBar key={tag.tag_id} rank={index + 1} tag={tag} maxValue={maxValue} sortMode={sortMode} />
        ))}
      </div>

      {tags.top_tags.length > 10 && (
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
              Show All ({tags.top_tags.length}) <ChevronDown className="w-4 h-4" />
            </>
          )}
        </button>
      )}

      {/* Tag preferences */}
      {(tags.tag_preferences.loved.length > 0 || tags.tag_preferences.avoided.length > 0) && (
        <div className="mt-6 pt-6 border-t border-[color:var(--rule)]">
          <h4 className="fig-label mb-3">
            Taste Analysis
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tags.tag_preferences.loved.length > 0 && (
              <div>
                <p className="st-card-sub mb-2">
                  You rate higher than average:
                </p>
                <div className="flex flex-wrap gap-2">
                  {tags.tag_preferences.loved.slice(0, 5).map((pref) => (
                    <Link
                      key={pref.tag_id}
                      href={`/stats/tag/g${pref.tag_id}`}
                      className="st-chip"
                    >
                      {pref.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {tags.tag_preferences.avoided.length > 0 && (
              <div>
                <p className="st-card-sub mb-2">
                  You rate lower than average:
                </p>
                <div className="flex flex-wrap gap-2">
                  {tags.tag_preferences.avoided.slice(0, 5).map((pref) => (
                    <Link
                      key={pref.tag_id}
                      href={`/stats/tag/g${pref.tag_id}`}
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

function TagBar({ rank, tag, maxValue, sortMode }: { rank: number; tag: TagStats; maxValue: number; sortMode: SortMode }) {
  // Calculate bar width based on sort mode
  let barValue: number;
  switch (sortMode) {
    case 'weighted':
      barValue = tag.weighted_score || 0;
      break;
    case 'count':
      barValue = tag.count;
      break;
    case 'rating':
      barValue = tag.avg_score;
      break;
    default:
      barValue = tag.weighted_score || 0;
  }
  const width = (barValue / maxValue) * 100;

  // Determine primary display value based on sort mode
  const primaryValue = sortMode === 'weighted' && tag.weighted_score
    ? tag.weighted_score.toFixed(2)
    : null;

  // Format tag ID for URL (tag_id is numeric, need to prepend 'g')
  const tagIdForUrl = `g${tag.tag_id}`;

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <RankNumber rank={rank} />
          <Link
            href={`/stats/tag/${tagIdForUrl}`}
            className="dg-name"
          >
            {tag.name}
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          <span className="text-[color:var(--nezu)]">
            {tag.count} VNs
          </span>
          {tag.avg_score > 0 && (
            <span className="text-[color:var(--nezu)]">
              {tag.avg_score.toFixed(1)}
            </span>
          )}
          {primaryValue && sortMode === 'weighted' && (
            <span
              className="st-num text-[color:var(--ink)]"
              title="Weighted score"
            >
              {primaryValue}
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
