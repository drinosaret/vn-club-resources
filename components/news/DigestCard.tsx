'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Layers, ChevronRight } from 'lucide-react';
import type { NewsListItem, NewsItem } from '@/lib/sample-news-data';
import { getSourceConfig, getRelativeTime } from '@/lib/sample-news-data';
import { DigestModal } from './DigestModal';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { getNewsImageUrl } from '@/lib/vndb-image-cache';

interface DigestCardProps {
  item: NewsListItem;
}

// Helper to get display title for a news item
function getNewsItemTitle(newsItem: NewsItem, preference: 'japanese' | 'romaji'): string {
  const isVndbSource = newsItem.source === 'vndb' || newsItem.source === 'vndb_release';
  if (isVndbSource) {
    return getDisplayTitle({
      title: newsItem.title,
      title_jp: newsItem.extraData?.alttitle as string | undefined,
    }, preference);
  }
  return newsItem.title;
}

export function DigestCard({ item }: DigestCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const sourceConfig = getSourceConfig(item.source);
  const relativeTime = getRelativeTime(item.publishedAt);
  const previewImages = item.previewImages || [];
  const digestItems = item.items || [];
  const { preference } = useTitlePreference();

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="flex flex-col w-full text-left bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 group h-full"
      >
        {/* Cover Image - Always present for consistent height */}
        <div className="relative w-full h-40 flex-shrink-0 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950/50 dark:via-indigo-950/50 dark:to-purple-950/50 overflow-hidden">
          {/* Shimmer placeholder - visible until image loads */}
          {previewImages.length > 0 && (
            <div className={`absolute inset-0 image-placeholder transition-opacity duration-300 z-0 ${imageLoaded ? 'opacity-0' : 'opacity-100'}`} />
          )}
          {previewImages.length > 0 ? (
            <>
              <Image
                src={getNewsImageUrl(previewImages[0])!}
                alt={digestItems.length > 0 ? getNewsItemTitle(digestItems[0], preference) : item.source}
                fill
                loading="lazy"
                className={`object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                onLoad={() => setImageLoaded(true)}
                unoptimized
              />
              {/* Count badge */}
              <div className="absolute bottom-3 right-3 bg-white/95 dark:bg-gray-800/95 px-3 py-1 rounded-full shadow-md flex items-center gap-1.5 z-10">
                <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {item.count} items
                </span>
              </div>
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-white/30 dark:bg-white/5" />
              <div className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-white/30 dark:bg-white/5" />
              <div className="flex flex-col items-center">
                <Layers className="w-10 h-10 text-blue-300 dark:text-blue-700 mb-2" />
                <span className="text-2xl font-bold text-blue-200 dark:text-blue-800/50">
                  {item.count} items
                </span>
              </div>
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
            <ChevronRight className="w-4 h-4 text-gray-400 ml-auto sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" />
          </div>

          {/* Title */}
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2 line-clamp-2 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
            {item.title}
          </h3>

          {/* Preview of item titles - fills remaining space */}
          <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-3 flex-grow">
            {digestItems.slice(0, 3).map(i => getNewsItemTitle(i, preference)).join(' | ')}
            {digestItems.length > 3 && '...'}
          </p>
        </div>
      </button>

      {/* Modal */}
      {isModalOpen && (
        <DigestModal
          title={item.title}
          items={digestItems}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  );
}
