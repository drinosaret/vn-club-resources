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
    let safetyTimer: ReturnType<typeof setTimeout>;

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

        // Only start progress for navigations to a different pathname.
        // Skip same-pathname changes (e.g. ?page=2 pagination) since those are
        // handled by pushState and won't trigger a Next.js route change.
        if (url.origin === window.location.origin && url.pathname !== window.location.pathname) {
          NProgress.start();
          // Safety timeout: auto-complete if route change takes too long
          clearTimeout(safetyTimer);
          safetyTimer = setTimeout(() => NProgress.done(), 10000);
        }
      } catch {
        // Invalid URL, ignore
      }
    };

    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
      clearTimeout(safetyTimer);
    };
  }, []);

  return null;
}
