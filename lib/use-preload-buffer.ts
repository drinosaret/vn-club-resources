import { useState, useRef, useEffect, startTransition } from 'react';

// ── Preload configuration ──────────────────────────────────────────────

export interface PreloadBufferConfig {
  /** Number of above-fold items to preload before swapping */
  preloadCount?: number;
  /** Fraction of preload URLs that must be ready before swapping (0–1) */
  threshold?: number;
  /** Maximum wait time in ms before swapping regardless */
  timeoutMs?: number;
}

/** Number of above-fold images to preload (legacy — used by NovelsSection) */
export const PRELOAD_COUNT = 12;

/** Above-fold preload counts per grid size.
 *  Based on: 2 rows x max columns at the xl breakpoint.
 *  small: 6 cols x 2 = 12, medium: 5 cols x 2 = 10, large: 4 cols x 2 = 8 */
export const PRELOAD_COUNTS: Record<string, number> = {
  small: 12,
  medium: 10,
  large: 8,
};

/** Default config for filter/search changes — wait for polished swap */
export const PRELOAD_DEFAULTS: Required<PreloadBufferConfig> = {
  preloadCount: PRELOAD_COUNT,
  threshold: 0.4,    // 40% of above-fold images
  timeoutMs: 600,    // Max wait before swap (cached images hit threshold in <10ms)
};

/** Lighter config for pagination — shorter wait since user expects fast pages.
 *  For prefetched pages (images in browser cache), threshold is met in <10ms. */
export const PAGINATION_PRELOAD: Required<PreloadBufferConfig> = {
  preloadCount: PRELOAD_COUNT,
  threshold: 0.25,   // 25% (~3 images)
  timeoutMs: 300,    // Reduced from 400ms — prefetched images resolve instantly
};

// ── Hook ───────────────────────────────────────────────────────────────

/**
 * Buffers item updates behind image preloading for smoother grid transitions.
 *
 * Old items stay visible while new images load in the background. Once enough
 * above-fold images are cached (threshold) or the timeout expires, the grid
 * swaps at once so each <img> loads from browser cache almost instantly.
 *
 * @param items       Current items to display
 * @param getPreloadUrls  Returns URLs to preload for a given item (main image + optional NSFW thumbnail)
 * @param options     Loading state, disabled flag, and preload config
 */
export function usePreloadBuffer<T>(
  items: T[],
  getPreloadUrls: (item: T) => string[],
  options?: {
    /** Don't process new items while true (e.g., API fetch in progress) */
    isLoading?: boolean;
    /** Skip preload — return items directly (e.g., pagination, list view) */
    disabled?: boolean;
    /** Preload timing config — use PAGINATION_PRELOAD or PRELOAD_DEFAULTS */
    config?: PreloadBufferConfig;
  },
): { displayItems: T[]; isSwapping: boolean } {
  const [displayItems, setDisplayItems] = useState<T[]>(items);
  const [isSwapping, setIsSwapping] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const hasDisplayedRef = useRef(false);

  // Refs for values that shouldn't trigger effect re-runs
  const configRef = useRef(options?.config);
  configRef.current = options?.config;
  const disabledRef = useRef(options?.disabled);
  disabledRef.current = options?.disabled;
  const getUrlsRef = useRef(getPreloadUrls);
  getUrlsRef.current = getPreloadUrls;
  const isLoading = options?.isLoading ?? false;

  useEffect(() => {
    // Cancel any in-progress preload
    cleanupRef.current?.();
    cleanupRef.current = null;

    // Empty items and done loading → show empty state
    if (items.length === 0 && !isLoading) {
      setDisplayItems([]);
      setIsSwapping(false);
      hasDisplayedRef.current = true;
      return;
    }

    // Still loading with no items → keep showing whatever we have
    if (items.length === 0) return;

    // First display → run preload so images are decoded before grid appears.
    // displayItems stays [] during preload; callers show skeleton until swap.
    if (!hasDisplayedRef.current) {
      hasDisplayedRef.current = true;
      // Fall through to preload logic below
    }

    // Disabled → sync internal state for when disabled flips back to false.
    // No startTransition needed — the return value below handles disabled display.
    if (disabledRef.current) {
      setDisplayItems(items);
      setIsSwapping(false);
      return;
    }

    // ── Preload buffer ─────────────────────────────────────────────────
    // Keep old items visible while loading new images in the background.
    setIsSwapping(true);
    let cancelled = false;

    const config = { ...PRELOAD_DEFAULTS, ...configRef.current };
    const getUrls = getUrlsRef.current;
    const toPreload = items.slice(0, config.preloadCount);

    // Count items with images for threshold calculation
    let itemsWithUrls = 0;
    for (const item of toPreload) {
      if (getUrls(item).length > 0) itemsWithUrls++;
    }

    // Threshold based on items with images
    const threshold = Math.max(1, Math.ceil(itemsWithUrls * config.threshold));

    const doSwap = () => {
      if (cancelled) return;
      cancelled = true;
      // startTransition makes React render concurrently (yielding to browser
      // for paints) instead of a single synchronous block that causes Firefox
      // WebRender to drop text in tiles outside the grid.
      // Both state updates must be in the same transition to prevent a frame
      // where isSwapping=false but displayItems is still stale.
      startTransition(() => {
        setDisplayItems(items);
        setIsSwapping(false);
      });
    };

    // No images to preload → swap immediately
    if (itemsWithUrls === 0) {
      doSwap();
      return;
    }

    // Preload images using Image() objects + decode() — ensures images are
    // both downloaded AND decoded into bitmaps before grid swap, preventing
    // decode jank when React renders the new grid content.
    //
    // Only the primary URL per item (index 0 = main cover image) counts
    // toward the threshold. Secondary URLs (e.g., NSFW tiny thumbnails)
    // are preloaded but don't affect swap timing — they're < 1KB and
    // would inflate the counter, causing the swap to fire before main
    // covers finish decoding.
    let loaded = 0;
    const onReady = () => {
      loaded++;
      if (loaded >= threshold) doSwap();
    };
    const noop = () => {};
    for (const item of toPreload) {
      const itemUrls = getUrls(item);
      for (let i = 0; i < itemUrls.length; i++) {
        const img = new Image();
        img.src = itemUrls[i];
        const cb = i === 0 ? onReady : noop;
        img.decode().then(cb, cb);
      }
    }

    // Don't wait forever — swap after timeout regardless
    const timeout = setTimeout(doSwap, config.timeoutMs);

    cleanupRef.current = () => {
      cancelled = true;
      clearTimeout(timeout);
    };

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [items, isLoading]);

  // When disabled (pagination/list view), return input items directly — no state
  // delay, no extra render. The grid shows new items on the same render that
  // receives them. The effect above syncs internal state for when disabled=false.
  const disabled = options?.disabled ?? false;
  return {
    displayItems: disabled ? items : displayItems,
    isSwapping: disabled ? false : isSwapping,
  };
}
