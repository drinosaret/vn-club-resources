'use client';

import { useState, useCallback } from 'react';

/**
 * Hook for consistent shimmer-to-instant image loading.
 * Matches the pattern used in VNGrid browse covers.
 */
export function useImageFade() {
  const [loaded, setLoaded] = useState(false);
  const onLoad = useCallback(() => setLoaded(true), []);

  return {
    loaded,
    onLoad,
    /** Apply to the shimmer placeholder div — no transition so preloaded images appear instantly */
    shimmerClass: loaded ? 'hidden' : 'absolute inset-0 image-placeholder',
    /** Merge into the image element's className */
    fadeClass: loaded ? 'opacity-100' : 'opacity-0',
  };
}
