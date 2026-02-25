import { getProxiedImageUrl, getTinySrc, type ImageWidth } from '@/lib/vndb-image-cache';
import { isNsfwContent } from '@/components/NSFWImage';

interface PrefetchItem {
  imageUrl: string;
  vnId: string;
  imageSexual?: number;
}

/**
 * Pre-decode VN cover images using Image() + decode().
 *
 * Downloads images AND decodes them into bitmaps in the background.
 * When the preload buffer later calls .decode() on grid swap, the
 * bitmap is already decoded → resolves in ~0ms (no decode jank).
 *
 * The .decode() promise keeps each Image object referenced (prevents GC)
 * until the bitmap is fully decoded.
 */
export function prefetchVNImages(items: PrefetchItem[], imageWidth: ImageWidth): void {
  for (const item of items) {
    const url = getProxiedImageUrl(item.imageUrl, { width: imageWidth, vnId: item.vnId });
    if (url) {
      const img = new Image();
      img.src = url;
      img.decode().catch(() => {});
      if (isNsfwContent(item.imageSexual)) {
        const t = new Image();
        t.src = getTinySrc(url);
        t.decode().catch(() => {});
      }
    }
  }
}

/**
 * Pre-decode VN cover images and wait for enough to be ready.
 *
 * Same as prefetchVNImages but returns a promise that resolves when
 * `threshold` fraction of primary images are decoded or `timeoutMs`
 * expires. Use this to keep a loading spinner visible while images
 * download, so the grid swap shows actual covers instead of grey shimmers.
 *
 * Only primary cover images count toward the threshold — NSFW tiny
 * thumbnails are preloaded but don't affect when the promise resolves.
 */
export function awaitVNImageDecode(
  items: PrefetchItem[],
  imageWidth: ImageWidth,
  opts?: { threshold?: number; timeoutMs?: number },
): Promise<void> {
  const threshold = opts?.threshold ?? 0.9;
  const timeoutMs = opts?.timeoutMs ?? 800;

  return new Promise<void>(resolve => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };

    // Collect primary image URLs
    const primaryUrls: string[] = [];
    for (const item of items) {
      const url = getProxiedImageUrl(item.imageUrl, { width: imageWidth, vnId: item.vnId });
      if (url) {
        primaryUrls.push(url);
        // Also start NSFW thumbnail decode (fire-and-forget)
        if (isNsfwContent(item.imageSexual)) {
          const t = new Image();
          t.src = getTinySrc(url);
          t.decode().catch(() => {});
        }
      }
    }

    if (primaryUrls.length === 0) { done(); return; }

    const needed = Math.max(1, Math.ceil(primaryUrls.length * threshold));
    let loaded = 0;
    const onReady = () => { if (++loaded >= needed) done(); };

    for (const url of primaryUrls) {
      const img = new Image();
      img.src = url;
      img.decode().then(onReady, onReady);
    }

    setTimeout(done, timeoutMs);
  });
}
