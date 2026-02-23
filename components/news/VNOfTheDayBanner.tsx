'use client';

import Link from 'next/link';
import { Star, ChevronRight } from 'lucide-react';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { NSFWNextImage } from '@/components/NSFWImage';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import type { VNOfTheDayData } from '@/lib/vn-of-the-day';

interface VNOfTheDayBannerProps {
  data: VNOfTheDayData;
}

export function VNOfTheDayBanner({ data }: VNOfTheDayBannerProps) {
  const { preference } = useTitlePreference();

  const numericId = data.vn_id.replace(/\D/g, '');
  const vnUrl = `/vn/${numericId}/`;
  const displayTitle = getDisplayTitle(
    { title: data.title, title_jp: data.title_jp ?? undefined, title_romaji: data.title_romaji ?? undefined },
    preference
  );
  const imageUrl = getProxiedImageUrl(data.image_url, { width: 128 });

  return (
    <Link
      href={vnUrl}
      className="group block bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 border-l-[3px] border-l-primary-500 p-4 hover:border-l-primary-400 transition-colors"
    >
      <div className="flex items-center gap-4">
        {/* Cover Thumbnail */}
        {imageUrl && (
          <div className="relative w-12 aspect-[3/4] rounded-lg overflow-hidden shrink-0 bg-gray-100 dark:bg-gray-700">
            <NSFWNextImage
              src={imageUrl}
              alt={data.title}
              imageSexual={data.image_sexual}
              vnId={data.vn_id}
              fill
              sizes="48px"
              className="object-cover"
              hideOverlay
            />
          </div>
        )}

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400">
              VN of the Day
            </span>
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
            {displayTitle}
          </p>
          {data.rating != null && data.votecount != null && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
              {data.rating.toFixed(2)}
              <span>({data.votecount.toLocaleString()})</span>
            </span>
          )}
        </div>

        {/* Arrow */}
        <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500 group-hover:text-primary-500 transition-colors shrink-0" />
      </div>
    </Link>
  );
}
