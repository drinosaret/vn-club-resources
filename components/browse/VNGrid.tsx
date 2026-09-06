'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import Link from '@/components/Link';
import { Star, Loader2, BookOpen } from 'lucide-react';
import { VNSearchResult } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl, getTinySrc, ImageWidth } from '@/lib/vndb-image-cache';
import { getDisplayTitle, TitlePreference } from '@/lib/title-preference';
import { GridSize, flexItemClasses } from './ViewModeToggle';
import { NSFWImage, isNsfwContent } from '@/components/NSFWImage';
import { usePreloadBuffer, PRELOAD_DEFAULTS, PRELOAD_COUNTS } from '@/lib/use-preload-buffer';
import { useImageLoadState } from '@/lib/use-image-load-state';
import { BrowseMetric, formatMetricValue } from '@/lib/browse-metrics';

// Map grid size to the primary image width for preloading and fallback.
// The actual rendering uses srcset with multiple widths so the browser
// picks the optimal variant per viewport. This "primary" width is used
// by the Image() preload objects and as the default src.
export const GRID_IMAGE_WIDTHS: Record<GridSize, ImageWidth> = {
  small: 256,   // 3 cols on mobile (~120px): 256px fine for 2x retina
  medium: 512,  // 2 cols on mobile (~195px): needs 512px for retina
  large: 512,   // 2 cols on mobile (~195px): needs 512px for retina
};

// srcset widths per grid size: lets the browser pick the smallest
// sufficient image for the actual CSS layout width + device pixel ratio.
// Smaller grid = smaller max image; larger grid = needs bigger images.
const GRID_SRCSET_WIDTHS: Record<GridSize, ImageWidth[]> = {
  small:  [128, 256],       // max ~170px CSS → 256 covers 1.5x DPR
  medium: [128, 256, 512],  // max ~210px CSS → 512 covers 2x+ DPR
  large:  [256, 512],       // max ~260px CSS → 512 covers 2x DPR
};

// Per-grid sizes attribute: matches actual rendered widths per breakpoint
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
  /** Ranking metric ordering the results, when the sort is one of them. */
  metric?: BrowseMetric | null;
}

export const VNGrid = memo(function VNGrid({ results, isLoading, showOverlay = false, skipPreload = false, preference, gridSize = 'medium', skeletonCount = 12, metric = null }: VNGridProps) {
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

  // Preload buffer: keeps old grid visible while new images load in background.
  // Pagination (skipPreload=true) disables the buffer for instant swap: prefetched
  // images are already decoded in browser cache, per-card shimmers handle stragglers.
  // Filter/search changes go through preload for a polished batch swap.
  const preloadCount = PRELOAD_COUNTS[gridSize] ?? 12;
  const config = { ...PRELOAD_DEFAULTS, preloadCount };
  const { displayItems: displayResults, isSwapping } = usePreloadBuffer(results, getPreloadUrls, {
    isLoading, config, disabled: skipPreload,
  });

  // Show empty state when query completes with no results
  if (!isLoading && !isSwapping && displayResults.length === 0 && results.length === 0) {
    return (
      <div className="bw-empty">
        <p className="bw-empty-title">No visual novels found</p>
        <p className="mt-1">Try adjusting your search or filters</p>
      </div>
    );
  }

  // Show skeleton grid only during true initial load (no cached results)
  if ((isLoading || isSwapping) && displayResults.length === 0) {
    return (
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-6 my-6">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i} className={flexItemClasses[gridSize]}>
            <div className="shelf-art">
              <div className="w-full h-full image-placeholder" />
            </div>
            <div className="mt-2 px-0.5 space-y-1">
              <div className="h-4 rounded-xs w-3/4 image-placeholder" />
              <div className="h-3 rounded-xs w-1/2 image-placeholder" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const isBusy = isLoading || isSwapping;

  // Show grid: keeps old results visible during loading and image preloading
  return (
    <div className="browse-vn-grid relative" style={{ contain: 'content' }}>
      {/* Loading overlay for filter/search changes (delayed, NOT shown for pagination) */}
      {hasMounted && (
        <div
          className={`bw-veil absolute inset-0 z-10 flex items-center justify-center
            transition-opacity duration-150 ease-out loading-overlay
            ${showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <Loader2 className="w-8 h-8 text-[color:var(--ai)] animate-spin" />
        </div>
      )}
      {/* Flexbox layout centers incomplete last row like VNDB */}
      <div className={`browse-vn-grid-content flex flex-wrap justify-center gap-x-4 gap-y-6 my-6 ${hasMounted && isBusy ? 'pointer-events-none' : ''}`}>
        {displayResults.map((vn, index) => (
          <VNCover key={index} vn={vn} preference={preference} imageWidth={GRID_IMAGE_WIDTHS[gridSize]} srcsetWidths={GRID_SRCSET_WIDTHS[gridSize]} imageSizes={IMAGE_SIZES[gridSize]} itemClass={flexItemClasses[gridSize]} aboveFold={index < preloadCount && !hasMounted} metric={metric} />
        ))}
      </div>
    </div>
  );
});

// Above-fold images use loading="eager" on SSR (before hydration) so the browser
// starts downloading them during HTML parse, before React hydrates and the
// preload buffer kicks in. After hydration (hasMounted=true), aboveFold is false
// for all items, so subsequent renders use loading="lazy" to avoid React 19's
// <link rel="preload"> accumulation across SWR re-renders.

interface VNCoverProps {
  vn: VNSearchResult;
  preference: TitlePreference;
  imageWidth?: ImageWidth;
  srcsetWidths?: ImageWidth[];
  imageSizes?: string;
  itemClass?: string;
  /** True for above-fold images on SSR: uses loading="eager" for faster LCP */
  aboveFold?: boolean;
  metric?: BrowseMetric | null;
}

const VNCover = memo(function VNCover({ vn, preference, imageWidth, srcsetWidths, imageSizes, itemClass, aboveFold, metric }: VNCoverProps) {
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
  const metricValue = formatMetricValue(metric, vn.metric_value);

  return (
    <Link
      href={`/vn/${vnId}`}
      className={`group shelf-item block ${itemClass || ''}`}
    >
      {/* Cover image container */}
      <div className="browse-vn-card shelf-art">
        {/* Cover Image: preloaded images display instantly from browser cache */}
        {showImage ? (
          <NSFWImage
            src={imageUrl}
            alt={title}
            imageSexual={vn.image_sexual}
            vnId={vnId}
            className={`absolute inset-0 w-full h-full object-cover object-top ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading={aboveFold ? "eager" : "lazy"}
            srcSet={srcset}
            sizes={imageSizes || IMAGE_SIZES.medium}
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[color:var(--text-faint)]">
            <BookOpen className="w-8 h-8" />
          </div>
        )}

        {/* Shimmer placeholder: rendered AFTER image so it stacks on top of NSFWOverlay,
            preventing NSFW tiny thumbnails from appearing before non-NSFW covers load */}
        {showImage && !imageLoaded && (
          <div className="absolute inset-0 image-placeholder" />
        )}

        {/* NSFW badge */}
        {isNsfw && (
          <div className="bw-mark bw-mark--age absolute top-1 right-1 px-1.5 py-0.5 font-bold z-10">
            18+
          </div>
        )}

        {/* The value the results are ordered by. Without it a ranked list asks the reader to
            take the order on trust, and the ordering column is not one of the two shown below
            the cover. */}
        {metricValue && (
          <div className="bw-mark absolute top-1 left-1 px-1.5 py-0.5 z-10 backdrop-blur-xs">
            {metricValue}
          </div>
        )}
      </div>

      {/* Info section below the cover - always visible */}
      <div className="px-0.5">
        <p className="browse-vn-title line-clamp-2" title={title}>
          {title}
        </p>
        <div className="browse-vn-meta flex items-center gap-2">
          {vn.rating && (
            <span className="flex items-center gap-0.5">
              <Star className="w-3 h-3 text-[color:var(--kohaku)] fill-current" />
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
    prevProps.itemClass === nextProps.itemClass &&
    prevProps.aboveFold === nextProps.aboveFold &&
    prevProps.metric === nextProps.metric &&
    prevProps.vn.metric_value === nextProps.vn.metric_value
  );
});
