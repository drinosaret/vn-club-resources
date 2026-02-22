'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Tag, ChevronDown, ChevronUp, ArrowUpDown, Info } from 'lucide-react';
import type { TagAnalytics, TagStats } from '@/lib/vndb-stats-api';

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
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Tag className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Top Tags
          </h3>
        </div>

        {/* Sort toggle */}
        <div className="flex items-center gap-1 text-sm">
          <ArrowUpDown className="w-4 h-4 text-gray-400" />
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-sm px-2 py-1 text-gray-700 dark:text-gray-300 text-sm focus:outline-hidden focus:ring-1 focus:ring-primary-500"
          >
            <option value="weighted">Weighted</option>
            <option value="count">Count</option>
            <option value="rating">Rating</option>
          </select>
          {sortMode === 'weighted' && (
            <div className="relative group" tabIndex={0} role="button" aria-label="Weighted score info">
              <Info className="w-4 h-4 text-gray-400 cursor-help" />
              <div className="absolute right-0 top-6 w-64 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all z-50">
                <p className="font-medium mb-1">Weighted Score</p>
                <p>Ranks by your ratings, with low-count entries pulled toward your personal average to prevent single-VN flukes from dominating.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3" style={showAll ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 500px' } : undefined}>
        {displayTags.map((tag) => (
          <TagBar key={tag.tag_id} tag={tag} maxValue={maxValue} sortMode={sortMode} />
        ))}
      </div>

      {tags.top_tags.length > 10 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-4 w-full py-2 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 flex items-center justify-center gap-1 transition-colors"
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
        <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-700">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Taste Analysis
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tags.tag_preferences.loved.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  You rate higher than average:
                </p>
                <div className="flex flex-wrap gap-2">
                  {tags.tag_preferences.loved.slice(0, 5).map((pref) => (
                    <Link
                      key={pref.tag_id}
                      href={`/stats/tag/g${pref.tag_id}`}
                      className="px-2 py-1 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-sm hover:bg-green-200 dark:hover:bg-green-800/40 transition-colors"
                    >
                      {pref.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {tags.tag_preferences.avoided.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  You rate lower than average:
                </p>
                <div className="flex flex-wrap gap-2">
                  {tags.tag_preferences.avoided.slice(0, 5).map((pref) => (
                    <Link
                      key={pref.tag_id}
                      href={`/stats/tag/g${pref.tag_id}`}
                      className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-sm hover:bg-red-200 dark:hover:bg-red-800/40 transition-colors"
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

function TagBar({ tag, maxValue, sortMode }: { tag: TagStats; maxValue: number; sortMode: SortMode }) {
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
      <div className="flex items-center justify-between mb-1">
        <Link
          href={`/stats/tag/${tagIdForUrl}`}
          className="text-sm text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        >
          {tag.name}
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500 dark:text-gray-400">
            {tag.count} VNs
          </span>
          {tag.avg_score > 0 && (
            <span className="text-gray-500 dark:text-gray-400">
              {tag.avg_score.toFixed(1)}
            </span>
          )}
          {primaryValue && sortMode === 'weighted' && (
            <span
              className="text-primary-600 dark:text-primary-400 font-medium"
              title="Weighted score"
            >
              {primaryValue}
            </span>
          )}
        </div>
      </div>
      <div className="h-2.5 bg-gray-100 dark:bg-gray-700/60 rounded-full overflow-hidden">
        <div
          className="h-full bg-linear-to-r from-primary-500 to-primary-400 dark:from-primary-600 dark:to-primary-400 rounded-full transition-all duration-300"
          style={{ width: `${Math.min(100, width)}%` }}
        />
      </div>
    </div>
  );
}
