import { getProxiedImageUrl, getTinySrc } from '@/lib/vndb-image-cache';
import { isNsfwContent } from '@/components/NSFWImage';

/** Preload VN cover images + NSFW micro-thumbnails into browser cache */
export function preloadVNImages(vns: Array<{ image_url?: string | null; id: string; image_sexual?: number | null }>) {
  vns.forEach(vn => {
    if (vn.image_url) {
      const img = new Image();
      const url = getProxiedImageUrl(vn.image_url, { width: 128, vnId: vn.id });
      if (url) {
        img.src = url;
        if (isNsfwContent(vn.image_sexual)) {
          new Image().src = getTinySrc(url);
        }
      }
    }
  });
}

/** Preload character images + NSFW micro-thumbnails into browser cache */
export function preloadCharacterImages(chars: Array<{ image_url?: string | null; image_sexual?: number | null }>) {
  chars.forEach(char => {
    if (char.image_url) {
      const img = new Image();
      const url = getProxiedImageUrl(char.image_url, { width: 128 });
      if (url) {
        img.src = url;
        if (isNsfwContent(char.image_sexual)) {
          new Image().src = getTinySrc(url);
        }
      }
    }
  });
}

/** Append cache-buster to image URL for retry */
export function addRetryKey(url: string, retryKey: number): string {
  if (retryKey === 0) return url;
  return `${url}${url.includes('?') ? '&' : '?'}_r=${retryKey}`;
}
