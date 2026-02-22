'use client';

import { ImageOff } from 'lucide-react';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { NSFWNextImage } from '@/components/NSFWImage';
import { ImageLightbox } from '@/components/ImageLightbox';
import { useImageFade } from '@/hooks/useImageFade';

interface VNCoverProps {
  imageUrl?: string;
  imageSexual?: number;
  title: string;
  /** VN ID for blacklist checking (e.g., "v535") */
  vnId?: string;
  /** Additional className for the container */
  className?: string;
}

export function VNCover({ imageUrl, imageSexual, title, vnId, className = '' }: VNCoverProps) {
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  const proxiedUrl = imageUrl ? getProxiedImageUrl(imageUrl, { width: 512, vnId }) : null;

  return (
    <div className={`relative w-full ${className}`}>
      <ImageLightbox src={proxiedUrl ?? ''} alt={title} imageSexual={imageSexual} vnId={vnId}>
        <div className="relative aspect-3/4 rounded-xl overflow-hidden bg-gray-200 dark:bg-gray-700 shadow-xl cursor-pointer ring-1 ring-black/5 dark:ring-white/10">
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
                sizes="(max-width: 1024px) 280px, 280px"
                priority
                unoptimized
                hideOverlay
                onLoad={onLoad}
              />
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
              <ImageOff className="w-16 h-16" />
            </div>
          )}
        </div>
      </ImageLightbox>
    </div>
  );
}
