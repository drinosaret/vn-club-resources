'use client';

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Eye } from 'lucide-react';
import { useNSFWRevealContext } from '@/lib/nsfw-reveal';
import { getTinySrc } from '@/lib/vndb-image-cache';

const NSFW_THRESHOLD = 1.5;

interface ImageLightboxProps {
  children: React.ReactNode;
  src: string | null | undefined;
  alt: string;
  imageSexual?: number | null;
  vnId?: string;
}

export function ImageLightbox({ children, src, alt, imageSexual, vnId }: ImageLightboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [localRevealed, setLocalRevealed] = useState(false);
  const nsfwContext = useNSFWRevealContext();

  const isNsfw = (imageSexual ?? 0) >= NSFW_THRESHOLD;
  // Use context state if vnId provided, otherwise fall back to local state
  const isRevealed = vnId && nsfwContext ? nsfwContext.isRevealed(vnId) : localRevealed;
  const shouldBlockLightbox = isNsfw && !isRevealed && !nsfwContext?.allRevealed;

  const [lightboxLoaded, setLightboxLoaded] = useState(false);

  const openLightbox = useCallback(() => {
    setLightboxLoaded(false);
    setIsOpen(true);
  }, []);
  const closeLightbox = useCallback(() => setIsOpen(false), []);

  // Only render portal after mounting (client-side only)
  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeLightbox();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    // Prevent body scroll when lightbox is open
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, closeLightbox]);

  const handleRevealClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (vnId && nsfwContext) {
      nsfwContext.revealVN(vnId);
    } else {
      setLocalRevealed(true);
    }
  }, [vnId, nsfwContext]);

  // If no valid src, just render children without lightbox functionality
  if (!src) {
    return <>{children}</>;
  }

  return (
    <>
      {/* Clickable wrapper - no <a> overlay so mobile long-press reaches the actual <img> for proper context menu */}
      <div
        className={`relative block overflow-hidden rounded-[1px] ${shouldBlockLightbox ? '' : 'cursor-zoom-in'}`}
        data-nsfw-revealed={isRevealed || !isNsfw}
        {...(shouldBlockLightbox ? {} : {
          onClick: openLightbox,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openLightbox();
            }
          },
          role: 'button' as const,
          tabIndex: 0,
          'aria-label': `View ${alt} fullscreen`,
        })}
      >
        {children}

        {/* NSFW reveal overlay - pixelated micro-thumbnail + scrim */}
        {shouldBlockLightbox && src && (
          <button
            onClick={handleRevealClick}
            className="absolute inset-0 z-20 flex items-center justify-center cursor-pointer group/nsfw"
            aria-label={`Click to reveal: ${alt}`}
          >
            {/* 32px thumbnail + pixelated rendering = mosaic censor, zero GPU cost */}
            <img
              src={getTinySrc(src)}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ imageRendering: 'pixelated' }}
              decoding="async"
            />
            <div className="sw-veil">
              <div className="sw-reveal">
                <Eye className="w-5 h-5" />
                <span>Click to reveal</span>
              </div>
            </div>
          </button>
        )}
      </div>

      {/* Lightbox overlay - rendered via portal to avoid HTML nesting issues */}
      {mounted && isOpen && createPortal(
        <div
          className="sw-scrim z-50 flex items-center justify-center backdrop-blur-xs on-box"
          onClick={closeLightbox}
        >
          {/* Close button */}
          <button
            onClick={closeLightbox}
            className="sw-icon sw-icon--over absolute top-4 right-4"
            aria-label="Close lightbox"
          >
            <X className="w-8 h-8" />
          </button>

          {/* Loading spinner */}
          {!lightboxLoaded && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="sw-spin sw-spin--over h-9 w-9" />
            </div>
          )}

          {/* Full-size image - using img for lightbox overlay as Next/Image doesn't work well in portals */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className={`max-w-[90vw] max-h-[90vh] object-contain rounded-[2px] transition-opacity duration-300 ${lightboxLoaded ? 'opacity-100' : 'opacity-0'}`}
            decoding="async"
            onClick={(e) => e.stopPropagation()}
            onLoad={() => setLightboxLoaded(true)}
          />

          {/* Click outside hint */}
          <span className="sw-plate absolute bottom-4">
            Click outside or press Escape to close
          </span>
        </div>,
        document.body
      )}
    </>
  );
}
