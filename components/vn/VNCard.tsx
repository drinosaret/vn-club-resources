'use client';

import Link from 'next/link';
import { BookOpen, Star } from 'lucide-react';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { CARD_IMAGE_WIDTH, CARD_IMAGE_SIZES, buildCardSrcSet } from './card-image-utils';
import { useDisplayTitle } from '@/lib/title-preference';
import { NSFWImage } from '@/components/NSFWImage';
import { useImageFade } from '@/hooks/useImageFade';

interface VNCardProps {
  id: string;
  title: string;
  titleJp?: string;
  titleRomaji?: string;
  imageUrl?: string | null;
  imageSexual?: number;
  rating?: number | null;
  badge?: React.ReactNode;
}

export function VNCard({ id, title, titleJp, titleRomaji, imageUrl, imageSexual, rating, badge }: VNCardProps) {
  const getDisplayTitle = useDisplayTitle();
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  const displayTitle = getDisplayTitle({ title, title_jp: titleJp, title_romaji: titleRomaji });

  const proxiedUrl = getProxiedImageUrl(imageUrl, { width: CARD_IMAGE_WIDTH, vnId: id });
  const srcSet = imageUrl ? buildCardSrcSet(imageUrl, id) : undefined;

  return (
    <Link
      href={`/vn/${id}`}
      className="group block bg-gray-50 dark:bg-gray-700/50 rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-500 transition-all"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 280px' }}
    >
      <div className="relative aspect-[3/4] bg-gray-200 dark:bg-gray-700">
        {imageUrl ? (
          <>
            <div className={shimmerClass} />
            <NSFWImage
              src={proxiedUrl}
              alt={displayTitle}
              vnId={id}
              imageSexual={imageSexual}
              className={`w-full h-full object-cover object-top ${fadeClass}`}
              loading="lazy"
              srcSet={srcSet}
              sizes={CARD_IMAGE_SIZES}
              onLoad={onLoad}
            />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <BookOpen className="w-8 h-8" />
          </div>
        )}

        {rating != null && (
          <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/70 text-white text-xs rounded">
            <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
            {rating.toFixed(1)}
          </div>
        )}

        {badge}
      </div>

      <div className="p-2">
        <h4 className="font-medium text-xs text-gray-900 dark:text-white line-clamp-2 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
          {displayTitle}
        </h4>
      </div>
    </Link>
  );
}
