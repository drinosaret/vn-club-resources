'use client';

import Link from '@/components/Link';
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
    <section className="vn-sec p-4 sm:p-5">
      <div className="vn-sec-head">
        <h2 className="vn-sec-title">In Context</h2>
      </div>
      {/* Each figure is one standing against a field, so the three read as one row of
          measurements rather than three cards tinted apart from each other. */}
      <div className="flex flex-wrap gap-4">
        {developer_rank && (
          <div className="flex-1 min-w-[180px]">
            <span className="fig-label">Developer rank</span>
            <div className="vn-num mt-1 text-lg text-[color:var(--ink)]">
              #{developer_rank.rank}{' '}
              <span className="text-sm text-[color:var(--nezu)]">
                of {developer_rank.total} ranked{developer_rank.total_all ? ` (${developer_rank.total_all} total)` : ''}
              </span>
            </div>
            <div className="text-xs text-[color:var(--nezu)] mt-0.5">
              from {getEntityDisplayName(
                { name: developer_rank.developer_name, original: developer_rank.developer_name_original },
                preference
              )}
            </div>
          </div>
        )}
        {genre_percentile && (
          <div className="flex-1 min-w-[180px]">
            <span className="fig-label">Genre standing</span>
            <div className="vn-num mt-1 text-lg text-[color:var(--ink)]">
              Top {(() => {
                const top = 100 - genre_percentile.percentile;
                if (top < 1) return '<1';
                return Math.round(top);
              })()}%
            </div>
            <div className="text-xs text-[color:var(--nezu)] mt-0.5">
              among{' '}
              <Link
                href={`/browse/?tags=${genre_percentile.tag_id}&include_children=true&min_votecount=10&tag_names=${encodeURIComponent(`tag:${genre_percentile.tag_id}:${genre_percentile.tag_name}`)}`}
                className="text-[color:var(--ai)] hover:underline"
              >
                {genre_percentile.total_in_genre.toLocaleString()}{genre_percentile.jp_count > 0 ? ` (${genre_percentile.jp_count.toLocaleString()} JP)` : ''} {genre_percentile.tag_name} VNs with 10+ votes
              </Link>
            </div>
          </div>
        )}
        {length_comparison && (
          <div className="flex-1 min-w-[180px]">
            <span className="fig-label">Length group</span>
            <div className="vn-num mt-1 text-lg text-[color:var(--ink)]">
              {length_comparison.vn_score.toFixed(1)}{' '}
              <span className="text-sm text-[color:var(--nezu)]">
                vs {length_comparison.length_avg_score.toFixed(1)} avg
              </span>
            </div>
            <div className="text-xs text-[color:var(--nezu)] mt-0.5">
              for {length_comparison.count_in_length.toLocaleString()}{length_comparison.jp_count > 0 ? ` (${length_comparison.jp_count.toLocaleString()} JP)` : ''} {length_comparison.length_label} VNs with 10+ votes
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
