'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ExternalLink, Gamepad2, Newspaper, Twitter } from 'lucide-react';
import type { NewsListItem } from '@/lib/sample-news-data';
import { getSourceConfig, getRelativeTime } from '@/lib/sample-news-data';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { getNewsImageUrl } from '@/lib/vndb-image-cache';
import { useImageFade } from '@/hooks/useImageFade';
import { LinkifiedText } from './LinkifiedText';

interface NewsCardProps {
  item: NewsListItem;
}

export function NewsCard({ item }: NewsCardProps) {
  const sourceConfig = getSourceConfig(item.source);
  const relativeTime = getRelativeTime(item.publishedAt);
  const [imageError, setImageError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);
  const { onLoad: onImageLoad, shimmerClass, fadeClass } = useImageFade();
  const { preference } = useTitlePreference();

  // For VNDB sources, use title preference; otherwise use title as-is
  const isVndbSource = item.source === 'vndb' || item.source === 'vndb_release';
  const displayTitle = isVndbSource
    ? getDisplayTitle({
        title: item.title,
        title_jp: item.extraData?.alttitle as string | undefined,
      }, preference)
    : item.title;

  const safeUrl = item.url && /^https?:\/\//.test(item.url) ? item.url : undefined;

  const hasValidImage = item.imageUrl && !item.imageIsNsfw && !imageError;
  const isTwitter = item.source === 'twitter';

  // Placeholder config per source type
  const isRss = item.source === 'rss';
  const PlaceholderIcon = isTwitter ? Twitter : isVndbSource ? Gamepad2 : Newspaper;
  const placeholderGradient = isTwitter
    ? 'from-sky-50 via-blue-50 to-indigo-50 dark:from-sky-950/50 dark:via-blue-950/50 dark:to-indigo-950/50'
    : isVndbSource
    ? 'from-indigo-50 via-purple-50 to-fuchsia-50 dark:from-indigo-950/50 dark:via-purple-950/50 dark:to-fuchsia-950/50'
    : 'from-orange-50 via-amber-50 to-yellow-50 dark:from-orange-950/50 dark:via-amber-950/50 dark:to-yellow-950/50';
  const placeholderIconColor = isTwitter
    ? 'text-sky-300 dark:text-sky-700'
    : isVndbSource
    ? 'text-indigo-300 dark:text-indigo-700'
    : 'text-amber-300 dark:text-amber-700';

  // For RSS items, extract domain for favicon; for VNDB, use vndb.org favicon
  const faviconUrl = !faviconError && (
    isRss && safeUrl
      ? `https://icons.duckduckgo.com/ip3/${new URL(safeUrl).hostname}.ico`
      : isVndbSource
      ? 'https://icons.duckduckgo.com/ip3/vndb.org.ico'
      : null
  );

  return (
    <div
      className="relative flex flex-col bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-600 transition-[box-shadow,border-color] duration-150 group h-full"
    >
      {/* Stretched link — makes entire card clickable */}
      {safeUrl && (
        <a
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 z-0"
          aria-label={displayTitle}
        />
      )}

      {/* Cover Image - Always present for consistent height */}
      <div className="relative w-full h-40 shrink-0">
        {/* Gradient placeholder — always rendered behind the image */}
        <div className={`absolute inset-0 bg-linear-to-br ${placeholderGradient} flex items-center justify-center overflow-hidden`}>
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-white/30 dark:bg-white/5" />
          <div className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-white/30 dark:bg-white/5" />
          {faviconUrl ? (
            <div className="flex flex-col items-center gap-2">
              <img
                src={faviconUrl}
                alt=""
                width={48}
                height={48}
                className="rounded-lg shadow-sm"
                style={{ imageRendering: 'auto' }}
                onError={() => setFaviconError(true)}
              />
              <span className={`text-sm font-medium ${isVndbSource ? 'text-indigo-600/70 dark:text-indigo-400/50' : 'text-amber-600/70 dark:text-amber-400/50'}`}>
                {item.sourceLabel}
              </span>
            </div>
          ) : (
            <PlaceholderIcon className={`w-12 h-12 ${placeholderIconColor}`} />
          )}
        </div>

        {/* Actual image — layered on top, fades in on load */}
        {hasValidImage && (
          <>
            <div className={shimmerClass} />
            <Image
              src={getNewsImageUrl(item.imageUrl)!}
              alt={item.title}
              fill
              loading="lazy"
              className={`object-cover ${fadeClass}`}
              onError={() => setImageError(true)}
              onLoad={onImageLoad}
              unoptimized
            />
          </>
        )}
      </div>

      <div className="p-4 flex flex-col grow">
        {/* Source Badge & Time */}
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium ${sourceConfig?.color} ${sourceConfig?.darkColor}`}
          >
            {item.sourceLabel}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {relativeTime}
          </span>
          {safeUrl && (
            <ExternalLink className="w-3 h-3 text-gray-400 dark:text-gray-500 ml-auto sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" />
          )}
        </div>

        {/* Title (skip for Twitter — summary already has the full tweet text) */}
        {!isTwitter && (
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2 line-clamp-2 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
            {displayTitle}
          </h3>
        )}

        {/* Summary — URLs are linkified and clickable above the card's stretched link */}
        {item.summary && (
          <div className={`relative z-10 text-sm text-gray-600 dark:text-gray-400 grow ${isTwitter ? 'line-clamp-5' : 'line-clamp-3'}`}>
            <LinkifiedText text={item.summary} />
          </div>
        )}
      </div>
    </div>
  );
}
