'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import NProgress from 'nprogress';

// Configure NProgress
NProgress.configure({
  showSpinner: false,
  trickleSpeed: 200,
  minimum: 0.1,
});

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Complete progress when route changes
  useEffect(() => {
    NProgress.done();
  }, [pathname, searchParams]);

  // Start progress on link clicks
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // Skip if this click was an NSFW image reveal (no actual navigation)
      if ((e as any)._nsfwReveal) return;

      const target = e.target as HTMLElement;
      const anchor = target.closest('a');

      // Skip if no anchor or has special attributes
      if (!anchor?.href || anchor.target || anchor.download) return;

      try {
        const url = new URL(anchor.href);

        // Skip static assets (images, files that won't trigger page navigation)
        if (/\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|mp4|webm|mp3|wav)$/i.test(url.pathname)) {
          return;
        }

        // Only handle same-origin navigation to different pages
        if (url.origin === window.location.origin) {
          if (url.pathname !== window.location.pathname || url.search !== window.location.search) {
            NProgress.start();
          }
        }
      } catch {
        // Invalid URL, ignore
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return null;
}
