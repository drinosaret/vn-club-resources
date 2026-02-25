'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import Link from 'next/link';
import { Star, Loader2, BookOpen } from 'lucide-react';
import { VNSearchResult } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl, getTinySrc, ImageWidth } from '@/lib/vndb-image-cache';
import { getDisplayTitle, TitlePreference } from '@/lib/title-preference';
import { GridSize, flexItemClasses } from './ViewModeToggle';
import { NSFWImage, isNsfwContent } from '@/components/NSFWImage';
import { usePreloadBuffer, PRELOAD_DEFAULTS, PRELOAD_COUNTS } from '@/lib/use-preload-buffer';
import { useImageLoadState } from '@/lib/use-image-load-state';

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

interface VNGridProps {
  results: VNSearchResult[];
  isLoading: boolean;
  showOverlay?: boolean;
  skipPreload?: boolean;
  preference: TitlePreference;
  gridSize?: GridSize;
  skeletonCount?: number;
}

export const VNGrid = memo(function VNGrid({ results, isLoading, showOverlay = false, skipPreload = false, preference, gridSize = 'medium', skeletonCount = 12 }: VNGridProps) {
  // Track if component has mounted to avoid hydration mismatches
  const [hasMounted, setHasMounted] = useState(false);

  // Set mounted state after hydration
  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Returns URLs to preload for a given VN (main image + NSFW micro-thumbnail)
  const getPreloadUrls = useCallback((vn: VNSearchResult) => {
    const urls: string[] = [];
    if (vn.image_url) {
      const vnId = vn.id.startsWith('v') ? vn.id : `v${vn.id}`;
      const url = getProxiedImageUrl(vn.image_url, { width: GRID_IMAGE_WIDTHS[gridSize], vnId });
      if (url) {
        urls.push(url);
        if (isNsfwContent(vn.image_sexual)) urls.push(getTinySrc(url));
      }
    }
    return urls;
  }, [gridSize]);

  // Preload buffer — keeps old grid visible while new images load in background.
  // Pagination uses aggressive config: for prefetched pages images decode from
  // browser cache in ~5-15ms (no white flash). Non-prefetched pages timeout at
  // 150ms — still fast, and any remaining images pop in via per-card shimmer.
  const preloadCount = PRELOAD_COUNTS[gridSize] ?? 12;
  const config = skipPreload
    ? { preloadCount, threshold: 0.9, timeoutMs: 150 }
    : { ...PRELOAD_DEFAULTS, preloadCount };
  const { displayItems: displayResults, isSwapping } = usePreloadBuffer(results, getPreloadUrls, {
    isLoading, config,
  });

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
      <div className={`browse-vn-grid-content flex flex-wrap justify-center gap-x-4 gap-y-6 my-6 ${hasMounted && isBusy ? 'pointer-events-none' : ''}`}>
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
  const title = getDisplayTitle({
    title: vn.title,
    title_jp: vn.title_jp || vn.alttitle,
    title_romaji: vn.title_romaji,
  }, preference);

  // VN ID format: "v123" - use as-is for internal route
  const vnId = vn.id.startsWith('v') ? vn.id : `v${vn.id}`;

  // Pass vnId for blacklist checking
  const baseImageUrl = vn.image_url ? getProxiedImageUrl(vn.image_url, { width: imageWidth, vnId }) : null;

  // Shared image state + retry logic
  const { imageUrl, showImage, imageLoaded, retryKey, handleImageLoad, handleImageError } = useImageLoadState(vn.id, baseImageUrl);

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
