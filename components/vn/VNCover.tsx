'use client';

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
    <div className={`vn-cover relative w-full ${className}`}>
      <ImageLightbox src={proxiedUrl ?? ''} alt={title} imageSexual={imageSexual} vnId={vnId}>
        {/* The art is the only saturated thing on the page, so nothing frames it but a
            hairline and a square corner. */}
        <div className="relative aspect-3/4 rounded-[1px] overflow-hidden bg-[color:var(--surface-inset)] cursor-pointer ring-1 ring-[color:var(--rule)]">
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
            <div className="w-full h-full flex items-center justify-center font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
              No cover
            </div>
          )}
        </div>
      </ImageLightbox>
    </div>
  );
}
