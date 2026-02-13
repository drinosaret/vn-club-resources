'use client';

import { Star, ImageOff } from 'lucide-react';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { NSFWNextImage } from '@/components/NSFWImage';
import { ImageLightbox } from '@/components/ImageLightbox';
import { useImageFade } from '@/hooks/useImageFade';

interface VNCoverProps {
  imageUrl?: string;
  imageSexual?: number;
  title: string;
  rating?: number;
  votecount?: number;
  /** VN ID for blacklist checking (e.g., "v535") */
  vnId?: string;
}

export function VNCover({ imageUrl, imageSexual, title, rating, votecount, vnId }: VNCoverProps) {
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  // Build proxied URL with VN ID for blacklist checking
  const proxiedUrl = imageUrl ? getProxiedImageUrl(imageUrl, { width: 512, vnId }) : null;

  return (
    <div className="relative w-full max-w-[280px] mx-auto lg:mx-0">
      {/* Cover image with 3:4 aspect ratio */}
      <ImageLightbox src={proxiedUrl ?? ''} alt={title} imageSexual={imageSexual} vnId={vnId}>
        <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-gray-200 dark:bg-gray-700 shadow-lg cursor-pointer">
          {imageUrl ? (
            <>
              <div className={shimmerClass} />
              <NSFWNextImage
                src={proxiedUrl}
                alt={title}
                imageSexual={imageSexual}
                vnId={vnId}
                className={`w-full h-full object-cover object-top ${fadeClass}`}
                fill
                sizes="280px"
                priority
                unoptimized // Proxied images already optimized as WebP
                hideOverlay // ImageLightbox provides its own overlay
                onLoad={onLoad}
              />
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
              <ImageOff className="w-16 h-16" />
            </div>
          )}

          {/* Rating badge overlay */}
          {rating != null && (
            <div className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 bg-black/85 text-white rounded-lg shadow-lg">
              <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
              <span className="font-bold">{rating.toFixed(2)}</span>
            </div>
          )}

          {/* Vote count at bottom */}
          {votecount !== undefined && votecount > 0 && (
            <div className="absolute bottom-3 left-3 px-2.5 py-1 bg-black/75 text-white text-xs rounded-lg">
              {votecount.toLocaleString()} votes
            </div>
          )}
        </div>
      </ImageLightbox>
    </div>
  );
}
