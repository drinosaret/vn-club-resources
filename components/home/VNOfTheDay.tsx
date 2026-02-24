'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Star, ArrowRight } from 'lucide-react';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { NSFWImage } from '@/components/NSFWImage';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { useImageFade } from '@/hooks/useImageFade';
import { stripBBCode } from '@/lib/bbcode';
import type { VNOfTheDayData } from '@/lib/vn-of-the-day';

interface VNOfTheDayProps {
  data: VNOfTheDayData | null;
}

/** Extract numeric ID from VN ID string (e.g., "v17" -> "17") */
function getNumericId(vnId: string): string {
  return vnId.replace(/\D/g, '');
}


export function VNOfTheDay({ data }: VNOfTheDayProps) {
  const { preference } = useTitlePreference();
  const { loaded, onLoad, shimmerClass, fadeClass } = useImageFade();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Skip fade-in animation during back-nav scroll restoration
    if (sessionStorage.getItem('is-popstate-navigation') === 'true') {
      setIsReady(true);
    } else {
      requestAnimationFrame(() => {
        setIsReady(true);
      });
    }
  }, []);

  if (!data) return null;

  const numericId = getNumericId(data.vn_id);
  const vnUrl = `/vn/${numericId}/`;
  const displayTitle = getDisplayTitle(
    { title: data.title, title_jp: data.title_jp ?? undefined, title_romaji: data.title_romaji ?? undefined },
    preference
  );
  const imageUrl = getProxiedImageUrl(data.image_url, { width: 256 });

  // Clean description: strip BBCode then collapse newlines for single-line preview
  const description = data.description
    ? stripBBCode(data.description).replace(/\n+/g, ' ').trim()
    : null;

  return (
    <section
      className={`pt-4 pb-10 md:pb-14 bg-gray-50 dark:bg-gray-900/50 transition-opacity duration-500 ${isReady ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 md:p-6">
          <div className="flex flex-col sm:flex-row gap-5 md:gap-6">
            {/* Cover Image */}
            <Link href={vnUrl} className="shrink-0 self-center sm:self-start">
              <div className="relative w-[140px] sm:w-[160px] md:w-[180px] aspect-[3/4] rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
                <div className={shimmerClass} />
                {imageUrl && (
                  <NSFWImage
                    src={imageUrl}
                    alt={data.title}
                    imageSexual={data.image_sexual}
                    vnId={data.vn_id}
                    className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${fadeClass}`}
                    loading="eager"
                    onLoad={onLoad}
                  />
                )}
              </div>
            </Link>

            {/* Info Panel */}
            <div className="flex flex-col min-w-0 flex-1">
              {/* Badge + Date */}
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400">
                  VN of the Day
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {new Date(data.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>

              {/* Title */}
              <Link href={vnUrl} className="group">
                <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors line-clamp-2">
                  {displayTitle}
                </h2>
              </Link>

              {/* Subtitle: JP title if different from display */}
              {data.title_jp && displayTitle !== data.title_jp && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 font-jp truncate">
                  {data.title_jp}
                </p>
              )}

              {/* Rating + Developer */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-gray-600 dark:text-gray-400">
                {data.rating != null && data.votecount != null && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                    <span className="font-medium text-gray-900 dark:text-white">{data.rating.toFixed(2)}</span>
                    <span className="text-gray-500 dark:text-gray-400">({data.votecount.toLocaleString()})</span>
                  </span>
                )}
                {data.developers.length > 0 && (
                  <span className="truncate">{data.developers.slice(0, 2).join(', ')}</span>
                )}
              </div>

              {/* Description */}
              {description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2 leading-relaxed">
                  {description}
                </p>
              )}

              {/* Tags */}
              {data.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {data.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag.name}
                      className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}

              {/* CTA Link */}
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

      </div>
    </section>
  );
}
