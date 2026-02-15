'use client';

import Link from 'next/link';
import type { ComparativeContext } from '@/lib/vndb-stats-api';
import { useTitlePreference, getEntityDisplayName } from '@/lib/title-preference';

interface VNComparativeContextProps {
  context: ComparativeContext;
}

export function VNComparativeContext({ context }: VNComparativeContextProps) {
  const { developer_rank, genre_percentile, length_comparison } = context;
  const { preference } = useTitlePreference();

  if (!developer_rank && !genre_percentile && !length_comparison) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        In Context
      </h3>
      <div className="flex flex-wrap gap-3">
        {developer_rank && (
          <div className="flex-1 min-w-[180px] rounded-lg p-3 bg-violet-50 dark:bg-violet-950/30 border border-violet-200/40 dark:border-violet-800/40">
            <div className="text-lg font-bold text-violet-700 dark:text-violet-400">
              #{developer_rank.rank}{' '}
              <span className="text-sm font-normal text-violet-500 dark:text-violet-500">
                of {developer_rank.total} ranked{developer_rank.total_all ? ` (${developer_rank.total_all} total)` : ''}
              </span>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              from {getEntityDisplayName(
                { name: developer_rank.developer_name, original: developer_rank.developer_name_original },
                preference
              )}
            </div>
          </div>
        )}
        {genre_percentile && (
          <div className="flex-1 min-w-[180px] rounded-lg p-3 bg-sky-50 dark:bg-sky-950/30 border border-sky-200/40 dark:border-sky-800/40">
            <div className="text-lg font-bold text-sky-700 dark:text-sky-400">
              Top {(() => {
                const top = 100 - genre_percentile.percentile;
                if (top < 1) return '<1';
                return Math.round(top);
              })()}%
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              among{' '}
              <Link
                href={`/browse/?tags=${genre_percentile.tag_id}&include_children=true&min_votecount=10&tag_names=${encodeURIComponent(`tag:${genre_percentile.tag_id}:${genre_percentile.tag_name}`)}`}
                className="text-sky-600 dark:text-sky-400 hover:underline"
              >
                {genre_percentile.total_in_genre.toLocaleString()}{genre_percentile.jp_count > 0 ? ` (${genre_percentile.jp_count.toLocaleString()} JP)` : ''} {genre_percentile.tag_name} VNs with 10+ votes
              </Link>
            </div>
          </div>
        )}
        {length_comparison && (
          <div className="flex-1 min-w-[180px] rounded-lg p-3 bg-teal-50 dark:bg-teal-950/30 border border-teal-200/40 dark:border-teal-800/40">
            <div className="text-lg font-bold text-teal-700 dark:text-teal-400">
              {length_comparison.vn_score.toFixed(1)}{' '}
              <span className="text-sm font-normal text-teal-500 dark:text-teal-500">
                vs {length_comparison.length_avg_score.toFixed(1)} avg
              </span>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              for {length_comparison.count_in_length.toLocaleString()}{length_comparison.jp_count > 0 ? ` (${length_comparison.jp_count.toLocaleString()} JP)` : ''} {length_comparison.length_label} VNs with 10+ votes
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
