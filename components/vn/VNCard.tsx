'use client';

import Link from '@/components/Link';
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
      className="shelf-item block"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 280px' }}
    >
      <div className="shelf-art">
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
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-faint)]">
            No cover
          </div>
        )}

        {rating != null && (
          <span className="vn-mark top-1.5 right-1.5">
            {rating.toFixed(1)}
          </span>
        )}

        {badge}
      </div>

      {/* A card is an entry in a list of works, so its name is a heading. The level suits a
          card sitting under a section heading, which is where every consumer puts it. */}
      <h3 className="shelf-name">{displayTitle}</h3>
    </Link>
  );
}
