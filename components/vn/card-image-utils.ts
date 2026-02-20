import { getProxiedImageUrl, type ImageWidth } from '@/lib/vndb-image-cache';

export const CARD_IMAGE_WIDTH: ImageWidth = 256;
export const THUMBNAIL_IMAGE_WIDTH: ImageWidth = 128;
const CARD_SRCSET_WIDTHS: ImageWidth[] = [128, 256];

// Matches grid: grid-cols-3 / sm:grid-cols-3 / md:grid-cols-4 / lg:grid-cols-5
export const CARD_IMAGE_SIZES =
  '(max-width: 640px) calc(33vw - 16px), (max-width: 768px) calc(33vw - 20px), (max-width: 1024px) calc(25vw - 18px), 180px';

export function buildCardSrcSet(imageUrl: string, vnId?: string): string | undefined {
  return CARD_SRCSET_WIDTHS
    .map(w => {
      const url = getProxiedImageUrl(imageUrl, { width: w, vnId });
      return url ? `${url} ${w}w` : null;
    })
    .filter(Boolean)
    .join(', ') || undefined;
}

// Compact grid (stats page NovelsSection) — smaller cards need smaller images
export const COMPACT_CARD_IMAGE_WIDTH: ImageWidth = 128;
const COMPACT_CARD_SRCSET_WIDTHS: ImageWidth[] = [128, 256];

// Matches grid: grid-cols-3 / sm:grid-cols-4 / md:grid-cols-5 / lg:grid-cols-6
export const COMPACT_CARD_IMAGE_SIZES =
  '(max-width: 640px) calc(33vw - 10px), (max-width: 768px) calc(25vw - 10px), (max-width: 1024px) calc(20vw - 10px), 180px';

export function buildCompactCardSrcSet(imageUrl: string, vnId?: string): string | undefined {
  return COMPACT_CARD_SRCSET_WIDTHS
    .map(w => {
      const url = getProxiedImageUrl(imageUrl, { width: w, vnId });
      return url ? `${url} ${w}w` : null;
    })
    .filter(Boolean)
    .join(', ') || undefined;
}
