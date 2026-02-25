'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Eye } from 'lucide-react';
import { useNSFWRevealContext } from '@/lib/nsfw-reveal';
import { getTinySrc } from '@/lib/vndb-image-cache';

const NSFW_THRESHOLD = 1.5;

// Shared hook for NSFW reveal logic - uses context for persistence when vnId provided
function useNSFWReveal(vnId?: string, imageSexual?: number | null) {
  const context = useNSFWRevealContext();
  const [localRevealed, setLocalRevealed] = useState(false);
  const lastPathname = useRef(context?.pathname);

  // Reset local state when pathname changes (handles Next.js router cache)
  if (context && context.pathname !== lastPathname.current) {
    lastPathname.current = context.pathname;
    if (localRevealed) setLocalRevealed(false);
  }

  const isNsfw = (imageSexual ?? 0) >= NSFW_THRESHOLD;

  // Use context state if vnId provided and context available, otherwise fall back to local state
  const isRevealed = vnId && context ? context.isRevealed(vnId) : localRevealed;
  const shouldBlur = isNsfw && !isRevealed && !context?.allRevealed;

  // Ref to hold latest state for native event handler (avoids stale closures)
  const stateRef = useRef({ shouldBlur, vnId, context, setLocalRevealed });
  stateRef.current = { shouldBlur, vnId, context, setLocalRevealed };

  // Ref for the wrapper div - used to attach native capture handler
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Native capture-phase click handler to reliably prevent Link navigation.
  // React 18 delegates all events to the root, so stopPropagation in React onClick
  // doesn't prevent a parent Link's handler from firing (both are dispatched from
  // the same root listener). A native capture handler on the wrapper fires before
  // the bubble phase, stopping the event before it reaches the Link.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const handler = (e: MouseEvent) => {
      const { shouldBlur, vnId, context, setLocalRevealed } = stateRef.current;
      if (shouldBlur) {
        e.preventDefault();
        e.stopPropagation();
        (e as any)._nsfwReveal = true;
        if (vnId && context) {
          context.revealVN(vnId);
        } else {
          setLocalRevealed(true);
        }
      }
    };

    el.addEventListener('click', handler, true);
    return () => el.removeEventListener('click', handler, true);
  }, []);

  // React handlers as fallback (e.g. before useEffect runs after hydration)
  const handleReveal = useCallback((e: React.MouseEvent) => {
    if (shouldBlur) {
      e.preventDefault();
      e.stopPropagation();
      // Mark native event so NavigationProgress knows not to show the loading bar
      (e.nativeEvent as any)._nsfwReveal = true;
      if (vnId && context) {
        context.revealVN(vnId);
      } else {
        setLocalRevealed(true);
      }
    }
  }, [shouldBlur, vnId, context]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (shouldBlur && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.stopPropagation();
      if (vnId && context) {
        context.revealVN(vnId);
      } else {
        setLocalRevealed(true);
      }
    }
  }, [shouldBlur, vnId, context]);

  return { shouldBlur, handleReveal, handleKeyDown, wrapperRef };
}


// Shared overlay: pixelated micro-thumbnail + dark scrim + label
function NSFWOverlay({ src }: { src: string }) {
  return (
    <>
      {/* 32px thumbnail + pixelated rendering = mosaic censor, zero GPU cost */}
      <img
        src={getTinySrc(src)}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover"
        style={{ imageRendering: 'pixelated' }}
        decoding="async"
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover/nsfw:bg-black/30 transition-colors pointer-events-none">
        <div className="flex flex-col items-center gap-1 text-white text-xs sm:text-[10px] font-medium drop-shadow-lg text-center px-2">
          <Eye className="w-5 h-5 sm:w-4 sm:h-4" />
          <span className="sm:hidden">Tap to reveal</span>
          <span className="hidden sm:inline">Click to reveal</span>
        </div>
      </div>
    </>
  );
}

interface NSFWImageProps {
  src: string | null | undefined;
  alt: string;
  imageSexual?: number | null;
  vnId?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  srcSet?: string;
  sizes?: string;
  onLoad?: () => void;
  onError?: () => void;
}

interface NSFWNextImageProps {
  src: string | null | undefined;
  alt: string;
  imageSexual?: number | null;
  vnId?: string;
  className?: string;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
  loading?: 'lazy' | 'eager';
  unoptimized?: boolean;
  width?: number;
  height?: number;
  onLoad?: () => void;
  onError?: () => void;
  /** Hide the overlay - use when wrapped by a component that provides its own overlay (e.g., ImageLightbox) */
  hideOverlay?: boolean;
}

export function NSFWImage({ src, alt, imageSexual, vnId, className = '', loading = 'lazy', srcSet, sizes, onLoad, onError }: NSFWImageProps) {
  const { shouldBlur, handleReveal, handleKeyDown, wrapperRef } = useNSFWReveal(vnId, imageSexual);
  const imgRef = useRef<HTMLImageElement>(null);

  // Handle already-cached images where onLoad won't fire
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalHeight > 0) {
      onLoad?.();
    }
  }, [onLoad]);

  if (!src) return null;

  return (
    <div
      ref={wrapperRef}
      className={`relative w-full h-full overflow-hidden ${shouldBlur ? 'cursor-pointer group/nsfw' : ''}`}
      onClick={handleReveal}
      onKeyDown={handleKeyDown}
      tabIndex={shouldBlur ? 0 : -1}
      role={shouldBlur ? 'button' : undefined}
      aria-label={shouldBlur ? `Click to reveal: ${alt}` : undefined}
      data-nsfw-revealed={!shouldBlur}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`${className}${shouldBlur ? ' invisible' : ''}`}
        loading={loading}
        decoding="async"
        srcSet={srcSet}
        sizes={sizes}
        onLoad={onLoad}
        onError={onError}
      />
      {shouldBlur && <NSFWOverlay src={src} />}
    </div>
  );
}

// Version using Next.js Image component
export function NSFWNextImage({ src, alt, imageSexual, vnId, className = '', fill, sizes, priority, loading, unoptimized, width, height, onLoad, onError, hideOverlay }: NSFWNextImageProps) {
  const { shouldBlur, handleReveal, handleKeyDown, wrapperRef } = useNSFWReveal(vnId, imageSexual);

  if (!src) return null;

  return (
    <div
      ref={wrapperRef}
      className={`relative overflow-hidden ${shouldBlur ? 'cursor-pointer group/nsfw' : ''} ${fill ? 'w-full h-full' : ''}`}
      onClick={handleReveal}
      onKeyDown={handleKeyDown}
      tabIndex={shouldBlur ? 0 : -1}
      role={shouldBlur ? 'button' : undefined}
      aria-label={shouldBlur ? `Click to reveal: ${alt}` : undefined}
      data-nsfw-revealed={!shouldBlur}
    >
      <Image
        src={src}
        alt={alt}
        className={`${className}${shouldBlur ? ' invisible' : ''}`}
        fill={fill}
        sizes={sizes}
        priority={priority}
        loading={loading}
        unoptimized={unoptimized}
        width={!fill ? width : undefined}
        height={!fill ? height : undefined}
        onLoad={onLoad}
        onError={onError}
      />
      {shouldBlur && !hideOverlay && <NSFWOverlay src={src} />}
    </div>
  );
}

// Helper for components that need to know if content is NSFW (for badges, etc.)
export function isNsfwContent(imageSexual?: number | null): boolean {
  return (imageSexual ?? 0) >= NSFW_THRESHOLD;
}
