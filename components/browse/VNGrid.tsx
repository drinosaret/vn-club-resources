'use client';

import { useState, useRef, useEffect, useCallback, useReducer, memo, startTransition } from 'react';
import Link from 'next/link';
import { Star, Loader2, BookOpen } from 'lucide-react';
import { VNSearchResult } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl, getTinySrc, ImageWidth } from '@/lib/vndb-image-cache';
import { getDisplayTitle, TitlePreference } from '@/lib/title-preference';
import { GridSize, flexItemClasses } from './ViewModeToggle';
import { NSFWImage, isNsfwContent } from '@/components/NSFWImage';

// Map grid size to the primary image width for preloading and fallback.
// The actual rendering uses srcset with multiple widths so the browser
// picks the optimal variant per viewport. This "primary" width is used
// by the Image() preload objects and as the default src.
export const GRID_IMAGE_WIDTHS: Record<GridSize, ImageWidth> = {
  small: 256,   // 3 cols on mobile (~120px) — 256px fine for 2x retina
  medium: 512,  // 2 cols on mobile (~195px) — needs 512px for retina
  large: 512,   // 2 cols on mobile (~195px) — needs 512px for retina
};

// srcset widths per grid size — lets the browser pick the smallest
// sufficient image for the actual CSS layout width + device pixel ratio.
// Smaller grid = smaller max image; larger grid = needs bigger images.
const GRID_SRCSET_WIDTHS: Record<GridSize, ImageWidth[]> = {
  small:  [128, 256],       // max ~170px CSS → 256 covers 1.5x DPR
  medium: [128, 256, 512],  // max ~210px CSS → 512 covers 2x+ DPR
  large:  [256, 512],       // max ~260px CSS → 512 covers 2x DPR
};

// Per-grid sizes attribute — matches actual rendered widths per breakpoint
// so the browser picks the smallest sufficient image variant
const IMAGE_SIZES: Record<GridSize, string> = {
  small:  '(max-width: 640px) calc(33vw - 8px), (max-width: 1024px) calc(25vw - 10px), 170px',
  medium: '(max-width: 640px) calc(50vw - 6px), (max-width: 1024px) calc(33vw - 8px), 210px',
  large:  '(max-width: 640px) calc(50vw - 6px), (max-width: 1024px) calc(33vw - 8px), 260px',
};

// Number of above-fold images to preload before swapping the grid
const PRELOAD_COUNT = 12;
// Fraction of preloaded images that must be ready before swapping
const PRELOAD_THRESHOLD = 0.4;
// Maximum time to wait for preloading before swapping anyway
const PRELOAD_TIMEOUT_MS = 800;

interface VNGridProps {
  results: VNSearchResult[];
  isLoading: boolean;
  showOverlay?: boolean;
  isPaginating?: boolean;
  skipPreload?: boolean;
  preference: TitlePreference;
  gridSize?: GridSize;
  skeletonCount?: number;
}

export const VNGrid = memo(function VNGrid({ results, isLoading, showOverlay = false, isPaginating = false, skipPreload = false, preference, gridSize = 'medium', skeletonCount = 12 }: VNGridProps) {
  // Track if component has mounted to avoid hydration mismatches
  const [hasMounted, setHasMounted] = useState(false);
  // Buffered results — only updated after images are preloaded
  const [displayResults, setDisplayResults] = useState<VNSearchResult[]>(results);
  // True while preloading images before a grid swap
  const [isSwapping, setIsSwapping] = useState(false);
  // Cleanup ref for cancelling in-progress preloads
  const preloadCleanupRef = useRef<(() => void) | null>(null);
  // Track whether we've ever displayed results (to skip preload on initial render)
  const hasDisplayedRef = useRef(false);

  // Set mounted state after hydration
  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Buffer new results behind image preloading for smoother grid transitions.
  // Old thumbnails stay visible while new images load in the background.
  // Once enough above-fold images are ready (or timeout), swap the grid at once.
  useEffect(() => {
    // Cancel any in-progress preload
    preloadCleanupRef.current?.();
    preloadCleanupRef.current = null;

    // Empty results and done loading → show empty state
    if (results.length === 0 && !isLoading) {
      setDisplayResults([]);
      setIsSwapping(false);
      return;
    }

    // No results yet (still loading) → keep showing whatever we have
    if (results.length === 0) return;

    // First time displaying results (SSR/initial load) → show immediately
    if (!hasDisplayedRef.current) {
      hasDisplayedRef.current = true;
      setDisplayResults(results);
      return;
    }

    // Pagination: skip preload buffer, show results immediately.
    // Individual VNCover shimmer placeholders handle image loading.
    // startTransition makes React render concurrently (yielding to browser for
    // paints) instead of a single 40ms+ synchronous block that causes Firefox
    // WebRender to drop text in tiles outside the grid.
    if (skipPreload) {
      startTransition(() => {
        setDisplayResults(results);
      });
      setIsSwapping(false);
      return;
    }

    // Start preloading above-fold images before swapping
    setIsSwapping(true);
    let cancelled = false;
    let loaded = 0;
    const toPreload = results.slice(0, PRELOAD_COUNT).filter(vn => vn.image_url);
    const threshold = Math.max(1, Math.ceil(toPreload.length * PRELOAD_THRESHOLD));

    const doSwap = () => {
      if (cancelled) return;
      cancelled = true;
      setDisplayResults(results);
      setIsSwapping(false);
    };

    // No images to preload → swap immediately
    if (toPreload.length === 0) {
      doSwap();
      return;
    }

    // Preload images using Image() objects — populates the browser cache
    // so when VNCover mounts, the <img> loads from cache almost instantly
    toPreload.forEach(vn => {
      const img = new Image();
      img.onload = img.onerror = () => {
        loaded++;
        if (loaded >= threshold) doSwap();
      };
      const vnId = vn.id.startsWith('v') ? vn.id : `v${vn.id}`;
      const url = getProxiedImageUrl(vn.image_url!, { width: GRID_IMAGE_WIDTHS[gridSize], vnId });
      if (url) {
        img.src = url;
        // Also preload the 20px micro-thumbnail for NSFW mosaic overlay so it
        // appears at the same time as non-NSFW covers (no delayed grey flash)
        if (isNsfwContent(vn.image_sexual)) {
          new Image().src = getTinySrc(url);
        }
      }
    });

    // Don't wait forever — swap after timeout regardless
    const timeout = setTimeout(doSwap, PRELOAD_TIMEOUT_MS);

    preloadCleanupRef.current = () => {
      cancelled = true;
      clearTimeout(timeout);
    };

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [results, isLoading, gridSize, skipPreload]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show empty state when query completes with no results
  if (!isLoading && !isSwapping && displayResults.length === 0 && results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400">
        <p className="text-lg font-medium">No visual novels found</p>
        <p className="text-sm">Try adjusting your search or filters</p>
      </div>
    );
  }

  // Show skeleton grid only during true initial load (no cached results)
  if ((isLoading || isSwapping) && displayResults.length === 0) {
    return (
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-6 my-6">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i} className={flexItemClasses[gridSize]}>
            <div className="aspect-3/4 rounded-lg overflow-hidden">
              <div className="w-full h-full image-placeholder" />
            </div>
            <div className="mt-1.5 px-0.5 space-y-1">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-sm w-3/4 animate-pulse" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-sm w-1/2 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const isBusy = isLoading || isSwapping;
  // Subtle dim only during the brief API fetch phase of pagination
  const shouldDim = isPaginating && isLoading;
  // Stale detection only needed for non-pagination preload transitions
  const isStale = !skipPreload && results !== displayResults && displayResults.length > 0 && results.length > 0;

  // Show grid — keeps old results visible during loading and image preloading
  return (
    <div className="browse-vn-grid relative" style={{ contain: 'content' }}>
      {/* Loading overlay for filter/search changes (delayed, NOT shown for pagination) */}
      {hasMounted && (
        <div
          className={`absolute inset-0 z-10 flex items-center justify-center
            bg-gray-50/50 dark:bg-gray-900/50
            transition-opacity duration-150 ease-out loading-overlay
            ${showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
        </div>
      )}
      {/* Flexbox layout centers incomplete last row like VNDB */}
      <div className={`browse-vn-grid-content flex flex-wrap justify-center gap-x-4 gap-y-6 my-6 transition-opacity duration-150 ease-out motion-reduce:transition-none ${hasMounted && isBusy ? 'pointer-events-none' : ''} ${hasMounted && (shouldDim || isStale) ? 'opacity-[0.85]' : ''}`}>
        {displayResults.map((vn, index) => (
          <VNCover key={index} vn={vn} preference={preference} imageWidth={GRID_IMAGE_WIDTHS[gridSize]} srcsetWidths={GRID_SRCSET_WIDTHS[gridSize]} imageSizes={IMAGE_SIZES[gridSize]} itemClass={flexItemClasses[gridSize]} />
        ))}
      </div>
    </div>
  );
});

// All browse grid images use loading="lazy" to prevent React 19 from injecting
// <link rel="preload" as="image"> into <head> for every non-lazy image.
// Those preload links accumulate across SWR re-renders and are never cleaned up,
// spamming the console with "preloaded with link preload was not used" warnings.
// The VNGrid's own preloading (new Image() for PRELOAD_COUNT above-fold images
// before grid swap) already handles the above-fold UX.

interface VNCoverProps {
  vn: VNSearchResult;
  preference: TitlePreference;
  imageWidth?: ImageWidth;
  srcsetWidths?: ImageWidth[];
  imageSizes?: string;
  itemClass?: string;
}

const VNCover = memo(function VNCover({ vn, preference, imageWidth, srcsetWidths, imageSizes, itemClass }: VNCoverProps) {
  // All image state in a single ref — mutations don't trigger renders.
  // useReducer provides a lightweight re-render trigger for onLoad/onError.
  const imgState = useRef({ loaded: false, error: false, retryKey: 0, retryCount: 0 });
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [, rerender] = useReducer(x => x + 1, 0);

  // Reset when VN changes (key={index} reuses the component instance).
  // Ref mutation — no setState during render, so React doesn't discard + retry.
  // This avoids 35× double renders (and ~350-500 discarded JSX objects) per pagination.
  const prevVnIdRef = useRef(vn.id);
  if (vn.id !== prevVnIdRef.current) {
    prevVnIdRef.current = vn.id;
    imgState.current = { loaded: false, error: false, retryKey: 0, retryCount: 0 };
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }

  const { loaded: imageLoaded, error: imageError, retryKey } = imgState.current;

  const title = getDisplayTitle({
    title: vn.title,
    title_jp: vn.title_jp || vn.alttitle,
    title_romaji: vn.title_romaji,
  }, preference);

  // VN ID format: "v123" - use as-is for internal route
  const vnId = vn.id.startsWith('v') ? vn.id : `v${vn.id}`;

  // Pass vnId for blacklist checking
  const baseImageUrl = vn.image_url ? getProxiedImageUrl(vn.image_url, { width: imageWidth, vnId }) : null;
  // Append cache-buster on retry to force browser to re-request
  const imageUrl = baseImageUrl && retryKey > 0
    ? `${baseImageUrl}${baseImageUrl.includes('?') ? '&' : '?'}_r=${retryKey}`
    : baseImageUrl;

  // Build srcset so the browser picks the smallest sufficient variant
  // for the actual layout width × device pixel ratio
  const srcset = vn.image_url && srcsetWidths
    ? srcsetWidths
        .map(w => {
          const url = getProxiedImageUrl(vn.image_url!, { width: w, vnId });
          return url ? `${url}${retryKey > 0 ? `${url.includes('?') ? '&' : '?'}_r=${retryKey}` : ''} ${w}w` : null;
        })
        .filter(Boolean)
        .join(', ')
    : undefined;
  const isNsfw = isNsfwContent(vn.image_sexual);
  const showImage = imageUrl && !imageError;

  useEffect(() => {
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, []);

  const handleImageError = useCallback(() => {
    const s = imgState.current;
    if (s.retryCount < 2) {
      const delay = s.retryCount === 0 ? 2000 : 5000;
      s.retryCount++;
      s.error = true;
      rerender();
      retryTimerRef.current = setTimeout(() => {
        s.error = false;
        s.loaded = false;
        s.retryKey++;
        rerender();
      }, delay);
    } else {
      s.error = true;
      rerender();
    }
  }, []);

  const handleImageLoad = useCallback(() => {
    imgState.current.loaded = true;
    rerender();
  }, []);

  return (
    <Link
      href={`/vn/${vnId}`}
      className={`group block ${itemClass || ''}`}
    >
      {/* Cover image container */}
      <div className="browse-vn-card relative aspect-3/4 rounded-lg overflow-hidden shadow-xs group-hover:shadow-lg group-hover:-translate-y-0.5 transition-[box-shadow,transform] duration-150 bg-gray-200 dark:bg-gray-700">
        {/* Shimmer placeholder — unmounted once image loads (no flash for preloaded images) */}
        {showImage && !imageLoaded && (
          <div className="absolute inset-0 image-placeholder" />
        )}

        {/* Cover Image — preloaded images display instantly from browser cache */}
        {showImage ? (
          <NSFWImage
            src={imageUrl}
            alt={title}
            imageSexual={vn.image_sexual}
            vnId={vnId}
            className={`absolute inset-0 w-full h-full object-cover object-top ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading="lazy"
            srcSet={srcset}
            sizes={imageSizes || IMAGE_SIZES.medium}
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 dark:text-gray-500">
            <BookOpen className="w-8 h-8" />
          </div>
        )}

        {/* NSFW badge */}
        {isNsfw && (
          <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded-sm z-10">
            18+
          </div>
        )}
      </div>

      {/* Info section below the cover - always visible */}
      <div className="mt-1.5 px-0.5">
        <p className="browse-vn-title text-sm font-medium text-gray-900 dark:text-white line-clamp-2 leading-tight group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors" title={title}>
          {title}
        </p>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {vn.rating && (
            <span className="flex items-center gap-0.5">
              <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
              {vn.rating.toFixed(2)}
            </span>
          )}
          {vn.released && (
            <span>{vn.released.substring(0, 4)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.vn.id === nextProps.vn.id &&
    prevProps.preference === nextProps.preference &&
    prevProps.imageWidth === nextProps.imageWidth &&
    prevProps.srcsetWidths === nextProps.srcsetWidths &&
    prevProps.imageSizes === nextProps.imageSizes &&
    prevProps.itemClass === nextProps.itemClass
  );
});
