'use client';

import Link from 'next/link';
import { BookOpen, Star, Sparkles, HelpCircle } from 'lucide-react';
import type { SimilarVN } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { useDisplayTitle } from '@/lib/title-preference';
import { NSFWImage } from '@/components/NSFWImage';
import { useImageFade } from '@/hooks/useImageFade';

interface VNContentSimilarProps {
  similar: SimilarVN[];
  isLoading?: boolean;
}

export function VNContentSimilar({ similar, isLoading }: VNContentSimilarProps) {
  // Subscribe to title preference context to ensure re-render when preference changes
  useDisplayTitle();

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Similar Games
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i}>
              <div className="aspect-[3/4] rounded-lg mb-2 image-placeholder" />
              <div className="h-4 rounded w-3/4 image-placeholder" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!similar || similar.length === 0) {
    return null; // Don't show empty section
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-primary-500" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Similar Games
        </h2>
        <div className="relative group/tooltip">
          <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help" />
          <div className="absolute left-1/2 -translate-x-1/2 sm:translate-x-0 sm:left-0 top-6 z-50 w-64 p-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200">
            Based on tag similarity. Games with similar themes, settings, and content tags are shown here.
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 sm:translate-x-0 sm:left-2 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {similar.map((vn) => (
          <SimilarVNCard key={vn.vn_id} vn={vn} />
        ))}
      </div>
    </div>
  );
}

function SimilarVNCard({ vn }: { vn: SimilarVN }) {
  const getDisplayTitle = useDisplayTitle();
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  const displayTitle = getDisplayTitle({ title: vn.title, title_jp: vn.title_jp, title_romaji: vn.title_romaji });

  return (
    <Link
      href={`/vn/${vn.vn_id}`}
      className="group block bg-gray-50 dark:bg-gray-700/50 rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-500 transition-all"
    >
      {/* Cover Image */}
      <div className="relative aspect-[3/4] bg-gray-200 dark:bg-gray-700">
        {vn.image_url ? (
          <>
            <div className={shimmerClass} />
            <NSFWImage
              src={getProxiedImageUrl(vn.image_url, { vnId: vn.vn_id })}
              alt={displayTitle}
              vnId={vn.vn_id}
              imageSexual={vn.image_sexual}
              className={`w-full h-full object-cover object-top ${fadeClass}`}
              loading="lazy"
              onLoad={onLoad}
            />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <BookOpen className="w-8 h-8" />
          </div>
        )}

        {/* Rating Badge */}
        {vn.rating && (
          <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/70 text-white text-xs rounded">
            <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
            {vn.rating.toFixed(1)}
          </div>
        )}

        {/* Similarity Badge */}
        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-primary-600/90 text-white text-xs rounded">
          {Math.round(vn.similarity * 100)}% match
        </div>
      </div>

      {/* Title */}
      <div className="p-2">
        <h4 className="font-medium text-xs text-gray-900 dark:text-white line-clamp-2 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
          {displayTitle}
        </h4>
      </div>
    </Link>
  );
}
