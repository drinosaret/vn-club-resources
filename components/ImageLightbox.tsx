'use client';

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ImageLightboxProps {
  children: React.ReactNode;
  src: string;
  alt: string;
}

export function ImageLightbox({ children, src, alt }: ImageLightboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const openLightbox = useCallback(() => setIsOpen(true), []);
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

  return (
    <>
      {/* Clickable wrapper for the image */}
      <span
        onClick={openLightbox}
        className="cursor-zoom-in block"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openLightbox();
          }
        }}
      >
        {children}
      </span>

      {/* Lightbox overlay - rendered via portal to avoid HTML nesting issues */}
      {mounted && isOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={closeLightbox}
        >
          {/* Close button */}
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 p-2 text-white/80 hover:text-white transition-colors rounded-full hover:bg-white/10"
            aria-label="Close lightbox"
          >
            <X className="w-8 h-8" />
          </button>

          {/* Full-size image - using img for lightbox overlay as Next/Image doesn't work well in portals */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Click outside hint */}
          <span className="absolute bottom-4 text-white/50 text-sm">
            Click outside or press Escape to close
          </span>
        </div>,
        document.body
      )}
    </>
  );
}
