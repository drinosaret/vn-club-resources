'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Star, ArrowRight, Sparkles, Leaf } from 'lucide-react';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { NSFWImage } from '@/components/NSFWImage';
import { getCoverSrc } from '@/lib/vndb-image-cache';
import { useImageFade } from '@/hooks/useImageFade';
import { stripBBCode } from '@/lib/bbcode';
import type { ClubPick } from '@/lib/events';

const KIND = {
  month: {
    label: 'VN of the Month',
    Icon: Sparkles,
    badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200',
  },
  season: {
    label: 'VN of the Season',
    Icon: Leaf,
    badge: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-200',
  },
} as const;

/** Home-page card for the monthly/seasonal pick, mirroring the VN of the Day card
 *  (score, developer, tags, EN/JP titles). Shows a placeholder when none is set. */
export function ClubPickCard({ pick, kind }: { pick: ClubPick | null; kind: 'month' | 'season' }) {
  const { preference } = useTitlePreference();
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Skip fade-in during back-nav scroll restoration.
    if (sessionStorage.getItem('is-popstate-navigation') === 'true') {
      setIsReady(true);
    } else {
      requestAnimationFrame(() => setIsReady(true));
    }
  }, []);

  const meta = KIND[kind];
  const Icon = meta.Icon;

  if (!pick) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-5 md:p-6 h-full flex flex-col">
        <div className="flex items-center gap-2 mb-2">
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}>
            {meta.label}
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center text-gray-400 dark:text-gray-500">
          <Icon className="w-9 h-9 mb-2 opacity-40" />
          <p className="text-sm">No {meta.label.toLowerCase()} selected yet.</p>
        </div>
      </div>
    );
  }

  const { vn, period } = pick;
  const numericId = (vn.id || '').replace(/\D/g, '');
  const vnUrl = `/vn/${numericId}/`;
  const displayTitle = getDisplayTitle(
    { title: vn.title, title_jp: vn.title_jp, title_romaji: vn.title_romaji },
    preference,
  );
  const imageUrl = getCoverSrc(vn.image_url, { width: 256 });
  const description = vn.description ? stripBBCode(vn.description).replace(/\n+/g, ' ').trim() : null;
  const developers = (vn.developers ?? []).map((d) => d.name);
  const tags = vn.tags ?? [];

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 md:p-6 h-full transition-opacity duration-500 ${isReady ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="flex flex-col sm:flex-row gap-5 md:gap-6 h-full">
        {/* Cover */}
        <Link href={vnUrl} className="shrink-0 self-center sm:self-start">
          <div className="relative w-[140px] sm:w-[160px] md:w-[180px] aspect-[3/4] rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
            <div className={shimmerClass} />
            {imageUrl ? (
              <NSFWImage
                src={imageUrl}
                alt={vn.title}
                imageSexual={vn.image_sexual ?? null}
                vnId={vn.id}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${fadeClass}`}
                loading="lazy"
                onLoad={onLoad}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Icon className="w-10 h-10 text-gray-300 dark:text-gray-600" />
              </div>
            )}
          </div>
        </Link>

        {/* Info */}
        <div className="flex flex-col min-w-0 flex-1">
          {/* Badge + period */}
          <div className="flex items-center gap-2 mb-2">
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}>
              {meta.label}
            </span>
            {period && <span className="text-xs text-gray-400 dark:text-gray-500">{period}</span>}
          </div>

          {/* Title */}
          <Link href={vnUrl} className="group">
            <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors line-clamp-2">
              {displayTitle}
            </h2>
          </Link>
          {vn.title_jp && displayTitle !== vn.title_jp && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 font-jp truncate">{vn.title_jp}</p>
          )}

          {/* Rating + Developer */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-gray-600 dark:text-gray-400">
            {vn.rating != null && vn.votecount != null && (
              <span className="inline-flex items-center gap-1">
                <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                <span className="font-medium text-gray-900 dark:text-white">{vn.rating.toFixed(2)}</span>
                <span className="text-gray-500 dark:text-gray-400">({vn.votecount.toLocaleString()})</span>
              </span>
            )}
            {developers.length > 0 && <span className="truncate">{developers.slice(0, 2).join(', ')}</span>}
          </div>

          {/* Description */}
          {description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2 leading-relaxed">
              {description}
            </p>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {tags.slice(0, 4).map((tag) => (
                <span
                  key={tag.name}
                  className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {/* CTA */}
          <Link
            href={vnUrl}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors mt-3 md:mt-auto pt-1"
          >
            View details
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
