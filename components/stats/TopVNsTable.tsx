'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Star, TrendingUp } from 'lucide-react';
import type { TopVN } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { LanguageFilter, LanguageFilterValue, filterByLanguage } from './LanguageFilter';
import { useTitlePreference, getDisplayTitle, type TitlePreference } from '@/lib/title-preference';
import { NSFWImage } from '@/components/NSFWImage';
import { useImageFade } from '@/hooks/useImageFade';

interface TopVNsTableProps {
  title: string;
  vns: TopVN[];
  showRating?: boolean;
  showVotes?: boolean;
  icon?: React.ReactNode;
}

export function TopVNsTable({
  title,
  vns,
  showRating = true,
  showVotes = true,
  icon,
}: TopVNsTableProps) {
  const [langFilter, setLangFilter] = useState<LanguageFilterValue>('ja');
  const { preference } = useTitlePreference();

  const filteredVNs = useMemo(() => {
    const filtered = vns.filter(vn => filterByLanguage(vn, langFilter));
    // Re-rank after filtering
    return filtered.map((vn, idx) => ({ ...vn, rank: idx + 1 }));
  }, [vns, langFilter]);

  if (vns.length === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon || <TrendingUp className="w-5 h-5 text-primary-500" />}
          <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
        </div>
        <LanguageFilter value={langFilter} onChange={setLangFilter} />
      </div>

      {filteredVNs.length === 0 ? (
        <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">
          No Japanese VNs in this list. Try switching to &quot;All Languages&quot;.
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {filteredVNs.map((vn) => (
            <TopVNRow key={vn.id} vn={vn} showRating={showRating} showVotes={showVotes} preference={preference} />
          ))}
        </div>
      )}
    </div>
  );
}

function TopVNRow({ vn, showRating, showVotes, preference }: { vn: TopVN & { rank: number }; showRating: boolean; showVotes: boolean; preference: TitlePreference }) {
  const { onLoad, shimmerClass, fadeClass } = useImageFade();

  return (
    <Link
      href={`/vn/${vn.id}`}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
    >
      {/* Rank */}
      <span className="w-6 text-center text-sm font-medium text-gray-400 dark:text-gray-500">
        {vn.rank}
      </span>

      {/* Cover thumbnail */}
      <div className="w-10 h-14 flex-shrink-0 rounded overflow-hidden bg-gray-200 dark:bg-gray-700 relative">
        {vn.image_url ? (
          <>
            <div className={shimmerClass} />
            <NSFWImage
              src={getProxiedImageUrl(vn.image_url, { width: 128, vnId: vn.id })}
              alt={getDisplayTitle({ title: vn.title, title_jp: vn.alttitle }, preference)}
              vnId={vn.id}
              imageSexual={vn.image_sexual}
              className={`w-full h-full object-cover object-top ${fadeClass}`}
              loading="lazy"
              onLoad={onLoad}
              onError={onLoad}
            />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <Star className="w-4 h-4" />
          </div>
        )}
      </div>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
          {getDisplayTitle({ title: vn.title, title_jp: vn.alttitle }, preference)}
        </p>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm">
        {showVotes && vn.votecount !== undefined && (
          <span className="text-gray-500 dark:text-gray-400 tabular-nums">
            {vn.votecount.toLocaleString()}
          </span>
        )}
        {showRating && vn.rating !== undefined && (
          <span className="flex items-center gap-1 font-semibold text-primary-600 dark:text-primary-400 tabular-nums">
            {vn.rating.toFixed(2)}
          </span>
        )}
      </div>
    </Link>
  );
}
