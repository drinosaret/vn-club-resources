'use client';

import { useState, useCallback } from 'react';

/**
 * Hook for consistent shimmer-to-instant image loading.
 * Matches the pattern used in VNGrid browse covers.
 */
export function useImageFade() {
  const [loaded, setLoaded] = useState(false);
  const onLoad = useCallback(() => setLoaded(true), []);

  // A server-rendered image can finish before the bundle runs, and a load event that has
  // already fired is never replayed, so the element is also inspected when it attaches.
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);

  return {
    loaded,
    onLoad,
    /** Attach to a plain img element; wrappers that check this themselves do not need it. */
    ref,
    /** Apply to the shimmer placeholder div. No transition so preloaded images appear instantly. */
    shimmerClass: loaded ? 'hidden' : 'absolute inset-0 image-placeholder',
    /** Merge into the image element's className */
    fadeClass: loaded ? 'opacity-100' : 'opacity-0',
  };
}
