'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef } from 'react';

// useLayoutEffect on client (runs before paint), useEffect on server (avoids SSR warning)
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const SCROLL_KEY_PREFIX = 'scroll-pos-';
const NAV_CLICK_KEY = 'stt-forward-nav';
/** Key for pages with async data loading to pick up the scroll target themselves */
const PENDING_SCROLL_KEY = 'stt-pending-scroll';
/** CSS class applied to <html> during scroll restoration to hide main content */
const RESTORING_CLASS = 'stt-restoring';
/** Key to skip scroll handling for the next navigation (e.g., news page filter changes) */
const NO_SCROLL_KEY = 'stt-no-scroll';

/**
 * Manages scroll position across navigation:
 * - Forward navigation (clicking links): Scrolls to top
 * - Back/forward navigation: Restores to saved scroll position
 *
 * Instead of using popstate (which is unreliable in Next.js App Router due to
 * useEffect cleanup racing with popstate events), this detects navigation type
 * by tracking link clicks: a link click sets a "forward nav" flag in
 * sessionStorage. The pathname effect checks this flag to determine behavior.
 */
export function ScrollToTop() {
  const pathname = usePathname();
  const prevPathname = useRef(pathname);

  // Disable browser's automatic scroll restoration - we handle it manually
  useEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
  }, []);

  // Handle hash fragment on initial page load (two-phase approach).
  // Phase 1 (layout effect): Hide content before paint so the user never sees
  // the browser's native hash scroll position (which is wrong after LazyImage
  // layout shifts during hydration).
  useIsomorphicLayoutEffect(() => {
    if (window.location.hash) {
      document.documentElement.classList.add(RESTORING_CLASS);
    }
  }, []);

  // Phase 2 (effect): After hydration effects settle (LazyImage placeholder
  // changes), scroll to the hash target with manual navbar offset and reveal.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const timeoutId = setTimeout(() => {
      const element = document.getElementById(id);
      if (element) {
        const top = element.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo(0, Math.max(0, top));
      }
      document.documentElement.classList.remove(RESTORING_CLASS);
    }, 100);
    return () => {
      clearTimeout(timeoutId);
      document.documentElement.classList.remove(RESTORING_CLASS);
    };
  }, []);

  // Save scroll position and mark forward navigation on internal link clicks
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const link = (e.target as Element).closest('a');
      if (link && link.href && !link.href.startsWith('#') && !link.href.startsWith('javascript:')) {
        try {
          const url = new URL(link.href);
          if (url.origin === window.location.origin) {
            // Save current scroll position for potential back navigation later
            sessionStorage.setItem(
              `${SCROLL_KEY_PREFIX}${pathname}`,
              String(window.scrollY)
            );
            // Mark this as a forward navigation (user clicked a link)
            sessionStorage.setItem(NAV_CLICK_KEY, 'true');
          }
        } catch {
          // Invalid URL, ignore
        }
      }
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [pathname]);

  // Ref for cleaning up stale MutationObserver/timeout when user re-navigates
  // before scroll restoration completes (prevents observer from scrolling wrong page)
  const scrollCleanupRef = useRef<(() => void) | null>(null);

  // Handle navigation: scroll to top (forward) or restore position (back/forward)
  // Uses useLayoutEffect to execute BEFORE browser paint, preventing position-0 flash
  useIsomorphicLayoutEffect(() => {
    if (pathname !== prevPathname.current) {
      // Clean up any in-flight scroll restoration from previous navigation
      if (scrollCleanupRef.current) {
        scrollCleanupRef.current();
        scrollCleanupRef.current = null;
      }

      // Always clean up coordination flag and restoring class from previous navigation.
      // Pages that read the flag (BrowsePageClient, TagDetail, etc.) may not
      // always remove it, so we must clear stale values here.
      sessionStorage.removeItem('is-popstate-navigation');
      document.documentElement.classList.remove(RESTORING_CLASS);

      const isForwardNav = sessionStorage.getItem(NAV_CLICK_KEY) === 'true';
      sessionStorage.removeItem(NAV_CLICK_KEY);

      // Skip all scroll handling if a component requested it (e.g., news filters)
      const skipScroll = sessionStorage.getItem(NO_SCROLL_KEY) === 'true';
      sessionStorage.removeItem(NO_SCROLL_KEY);
      if (skipScroll) {
        prevPathname.current = pathname;
        return;
      }

      if (isForwardNav) {
        // Forward navigation (link click) - scroll to top
        window.scrollTo(0, 0);
      } else {
        // Back/forward navigation (no link click preceded this)
        // Set coordination flag for BrowsePageClient and other consumers
        sessionStorage.setItem('is-popstate-navigation', 'true');

        // Try to restore saved scroll position
        const savedPosition = sessionStorage.getItem(`${SCROLL_KEY_PREFIX}${pathname}`);

        if (savedPosition) {
          const targetPosition = parseInt(savedPosition, 10);
          sessionStorage.removeItem(`${SCROLL_KEY_PREFIX}${pathname}`);
          // Store pending scroll so async pages can restore after their data loads
          sessionStorage.setItem(PENDING_SCROLL_KEY, String(targetPosition));

          // Hide main content immediately to prevent flash at position 0.
          // Runs in useLayoutEffect (before paint), so user never sees hidden state.
          document.documentElement.classList.add(RESTORING_CLASS);

          // Try scrolling immediately (no delay for static/cached pages)
          const canScroll = document.body.scrollHeight >= targetPosition + window.innerHeight;
          if (canScroll || targetPosition <= 0) {
            window.scrollTo(0, targetPosition);
            sessionStorage.removeItem(PENDING_SCROLL_KEY);
            requestAnimationFrame(() => {
              document.documentElement.classList.remove(RESTORING_CLASS);
            });
          } else {
            // Page isn't tall enough yet (async content) - watch for DOM changes
            let timeoutId: ReturnType<typeof setTimeout>;
            const restoreVisibility = () => {
              document.documentElement.classList.remove(RESTORING_CLASS);
            };

            const observer = new MutationObserver(() => {
              if (document.body.scrollHeight >= targetPosition + window.innerHeight) {
                window.scrollTo(0, targetPosition);
                sessionStorage.removeItem(PENDING_SCROLL_KEY);
                observer.disconnect();
                clearTimeout(timeoutId);
                requestAnimationFrame(restoreVisibility);
              }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            // Store cleanup so re-navigation can cancel stale observer/timeout
            scrollCleanupRef.current = () => {
              observer.disconnect();
              clearTimeout(timeoutId);
              restoreVisibility();
            };

            // Fallback: scroll to best available position after timeout
            timeoutId = setTimeout(() => {
              observer.disconnect();
              scrollCleanupRef.current = null;
              const canScrollNow = document.body.scrollHeight >= targetPosition + window.innerHeight;
              if (canScrollNow) {
                // Page became tall enough but observer missed it — scroll now
                window.scrollTo(0, targetPosition);
                sessionStorage.removeItem(PENDING_SCROLL_KEY);
              }
              // If page is still too short, leave PENDING_SCROLL_KEY intact
              // so async pages can call consumePendingScroll() after data loads
              restoreVisibility();
            }, 1500);
          }
        } else if (!savedPosition) {
          // No saved position (e.g., programmatic navigation or first visit)
          // Scroll to top as default behavior
          window.scrollTo(0, 0);
        }
      }

      prevPathname.current = pathname;
    }
  }, [pathname]);

  return null;
}

/**
 * Call before a programmatic navigation (router.push, Link click) to prevent
 * ScrollToTop from scrolling on the next pathname change. Useful for filter-like
 * interactions (news dates/tabs) where the user should stay at their current position.
 */
export function skipNextScroll(): void {
  sessionStorage.setItem(NO_SCROLL_KEY, 'true');
}

/**
 * Consume the pending scroll position set by ScrollToTop during back navigation.
 * Pages with async data loading should call this after their content has loaded
 * to restore the correct scroll position (since ScrollToTop's MutationObserver
 * may have fired before all async content rendered).
 */
export function consumePendingScroll(): void {
  const pending = sessionStorage.getItem(PENDING_SCROLL_KEY);
  if (pending) {
    const targetPosition = parseInt(pending, 10);
    sessionStorage.removeItem(PENDING_SCROLL_KEY);
    // Use requestAnimationFrame to scroll after React commit
    requestAnimationFrame(() => {
      window.scrollTo(0, targetPosition);
      // Remove visibility-hiding class now that scroll is restored
      document.documentElement.classList.remove(RESTORING_CLASS);
    });
  }
}
