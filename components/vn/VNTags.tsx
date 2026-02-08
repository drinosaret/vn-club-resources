'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, Tag } from 'lucide-react';
import type { VNTag } from '@/lib/vndb-stats-api';

interface VNTagsProps {
  tags?: VNTag[];
  maxTags?: number;
}

// Category colors
const categoryColors: Record<string, { bg: string; text: string; border: string }> = {
  cont: { // Content
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-800',
  },
  ero: { // Sexual content
    bg: 'bg-pink-50 dark:bg-pink-900/20',
    text: 'text-pink-700 dark:text-pink-300',
    border: 'border-pink-200 dark:border-pink-800',
  },
  tech: { // Technical
    bg: 'bg-gray-50 dark:bg-gray-700/50',
    text: 'text-gray-600 dark:text-gray-300',
    border: 'border-gray-200 dark:border-gray-600',
  },
};

// Default color for unknown categories
const defaultColor = categoryColors.cont;

export function VNTags({ tags, maxTags = 30 }: VNTagsProps) {
  const [showSpoilers, setShowSpoilers] = useState(false);
  const [showAll, setShowAll] = useState(false);

  if (!tags || tags.length === 0) {
    return null;
  }

  // Filter tags based on spoiler setting (spoiler: 0=none, 1=minor, 2=major)
  const filteredTags = showSpoilers
    ? tags
    : tags.filter(tag => tag.spoiler === 0);

  // Limit display
  const displayTags = showAll ? filteredTags : filteredTags.slice(0, maxTags);
  const hasMore = filteredTags.length > maxTags;

  // Count spoiler tags
  const spoilerCount = tags.filter(t => t.spoiler > 0).length;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Tag className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Tags
          </h2>
          <span className="text-sm text-gray-400 dark:text-gray-500">
            ({filteredTags.length})
          </span>
        </div>

        {spoilerCount > 0 && (
          <button
            onClick={() => setShowSpoilers(!showSpoilers)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              showSpoilers
                ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {showSpoilers ? (
              <>
                <EyeOff className="w-4 h-4" />
                Hide spoilers
              </>
            ) : (
              <>
                <Eye className="w-4 h-4" />
                Show spoilers ({spoilerCount})
              </>
            )}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {displayTags.map((tag) => {
          const colors = categoryColors[tag.category || 'cont'] || defaultColor;
          const isSpoiler = tag.spoiler > 0;

          return (
            <Link
              key={tag.id}
              href={`/stats/tag/${tag.id}`}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-sm rounded-lg border transition-colors hover:opacity-80 ${colors.bg} ${colors.text} ${colors.border} ${
                isSpoiler ? 'ring-1 ring-red-300 dark:ring-red-700' : ''
              }`}
              title={`Relevance: ${(tag.score * 33).toFixed(0)}%${isSpoiler ? ' (Spoiler)' : ''}`}
            >
              {tag.name}
              {isSpoiler && (
                <span className="text-xs text-red-500 dark:text-red-400">!</span>
              )}
            </Link>
          );
        })}
      </div>

      {hasMore && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-3 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
        >
          Show all {filteredTags.length} tags
        </button>
      )}
    </div>
  );
}
