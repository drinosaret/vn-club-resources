'use client';

import { useRef, useReducer, useCallback, useEffect } from 'react';

/**
 * VNCover-style image loading hook with auto-retry and shimmer unmount.
 *
 * Replaces useImageFade for stats cards. Key differences:
 * - useRef for state (no re-render per mutation) + useReducer for lightweight trigger
 * - Auto-retry on error: 2 retries with 2s/5s backoff, cache-buster ?_r=N
 * - Shimmer conditionally unmounted (not CSS hidden) — no flash for preloaded images
 */
export function useImageRetry() {
  const imgState = useRef({ loaded: false, error: false, retryKey: 0, retryCount: 0 });
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [, rerender] = useReducer(x => x + 1, 0);

  useEffect(() => {
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, []);

  const onLoad = useCallback(() => {
    imgState.current.loaded = true;
    rerender();
  }, []);

  const onError = useCallback(() => {
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

  return {
    loaded: imgState.current.loaded,
    error: imgState.current.error,
    retryKey: imgState.current.retryKey,
    onLoad,
    onError,
  };
}
