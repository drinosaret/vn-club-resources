'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ExternalLink, Newspaper, Twitter } from 'lucide-react';
import type { NewsListItem } from '@/lib/sample-news-data';
import { getSourceConfig, getRelativeTime } from '@/lib/sample-news-data';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { getNewsImageUrl } from '@/lib/vndb-image-cache';

interface NewsCardProps {
  item: NewsListItem;
}

export function NewsCard({ item }: NewsCardProps) {
  const sourceConfig = getSourceConfig(item.source);
  const relativeTime = getRelativeTime(item.publishedAt);
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
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
  const CardWrapper = safeUrl ? 'a' : 'div';
  const cardProps = safeUrl
    ? { href: safeUrl, target: '_blank', rel: 'noopener noreferrer' }
    : {};

  const hasValidImage = item.imageUrl && !item.imageIsNsfw && !imageError;
  const isTwitter = item.source === 'twitter';
  const isRss = item.source === 'rss';

  // Get placeholder icon based on source
  const PlaceholderIcon = isTwitter ? Twitter : Newspaper;
  const placeholderGradient = isTwitter
    ? 'from-sky-50 via-blue-50 to-indigo-50 dark:from-sky-950/50 dark:via-blue-950/50 dark:to-indigo-950/50'
    : 'from-orange-50 via-amber-50 to-yellow-50 dark:from-orange-950/50 dark:via-amber-950/50 dark:to-yellow-950/50';
  const placeholderIconColor = isTwitter
    ? 'text-sky-300 dark:text-sky-700'
    : 'text-amber-300 dark:text-amber-700';

  return (
    <CardWrapper
      {...cardProps}
      className="flex flex-col bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 group h-full"
    >
      {/* Cover Image - Always present for consistent height */}
      <div className="relative w-full h-40 flex-shrink-0">
        {/* Shimmer placeholder - visible until image loads */}
        {hasValidImage && (
          <div className={`absolute inset-0 image-placeholder transition-opacity duration-300 ${imageLoaded ? 'opacity-0' : 'opacity-100'}`} />
        )}
        {hasValidImage ? (
          <Image
            src={getNewsImageUrl(item.imageUrl)!}
            alt={item.title}
            fill
            loading="lazy"
            className={`object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            onError={() => setImageError(true)}
            onLoad={() => setImageLoaded(true)}
            unoptimized
          />
        ) : (
          <div className={`absolute inset-0 bg-gradient-to-br ${placeholderGradient} flex items-center justify-center overflow-hidden`}>
            {/* Decorative circles */}
            <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-white/30 dark:bg-white/5" />
            <div className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-white/30 dark:bg-white/5" />
            <PlaceholderIcon className={`w-12 h-12 ${placeholderIconColor}`} />
          </div>
        )}
      </div>

      <div className="p-4 flex flex-col flex-grow">
        {/* Source Badge & Time */}
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${sourceConfig?.color} ${sourceConfig?.darkColor}`}
          >
            {item.sourceLabel}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {relativeTime}
          </span>
          {item.url && (
            <ExternalLink className="w-3 h-3 text-gray-400 dark:text-gray-500 ml-auto sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" />
          )}
        </div>

        {/* Title */}
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2 line-clamp-2 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
          {displayTitle}
        </h3>

        {/* Summary - fills remaining space */}
        {item.summary && (
          <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3 flex-grow">
            {item.summary}
          </p>
        )}
      </div>
    </CardWrapper>
  );
}
