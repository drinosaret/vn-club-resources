'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { ImageLightbox } from './ImageLightbox';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}

export function LazyImage({ src, alt, className = '', style }: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  // Check if image is already cached/complete on mount
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current?.naturalHeight > 0) {
      setLoaded(true);
    }
  }, []);

  return (
    <ImageLightbox src={src} alt={alt}>
      <span
        className="relative block"
        style={{ minHeight: loaded ? 'auto' : '300px', display: 'block' }}
      >
        {/* Placeholder shown while loading */}
        {!loaded && (
          <span
            className="absolute inset-0 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse block"
            style={{ minHeight: '300px' }}
          />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className={`${className} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          style={style}
          onLoad={handleLoad}
        />
      </span>
    </ImageLightbox>
  );
}
