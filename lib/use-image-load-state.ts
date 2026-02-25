import { useRef, useEffect, useReducer, useCallback } from 'react';

/**
 * Shared image loading state with retry logic.
 *
 * Manages: loaded/error state, automatic retry (2 retries: 2s then 5s),
 * cache-buster URL on retry, and cleanup. Used by VNCover, NovelCard,
 * and NovelRow to avoid duplicating ~50 lines of identical logic.
 *
 * State lives in a ref (no setState during render) to avoid React
 * discard+retry on component reuse with key={index}. useReducer
 * provides a lightweight re-render trigger for onLoad/onError.
 */
export function useImageLoadState(id: string, baseImageUrl: string | null) {
  const imgState = useRef({ loaded: false, error: false, retryKey: 0, retryCount: 0 });
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [, rerender] = useReducer(x => x + 1, 0);

  // Reset when item changes (component instance reuse via key={index}).
  // Ref mutation — no setState during render, so React doesn't discard + retry.
  const prevIdRef = useRef(id);
  if (id !== prevIdRef.current) {
    prevIdRef.current = id;
    imgState.current = { loaded: false, error: false, retryKey: 0, retryCount: 0 };
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }

  // Cleanup retry timer on unmount
  useEffect(() => {
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, []);

  const handleImageLoad = useCallback(() => {
    imgState.current.loaded = true;
    rerender();
  }, []);

  const handleImageError = useCallback(() => {
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

  const { loaded: imageLoaded, error: imageError, retryKey } = imgState.current;

  // Append cache-buster on retry to force browser to re-request
  const imageUrl = baseImageUrl && retryKey > 0
    ? `${baseImageUrl}${baseImageUrl.includes('?') ? '&' : '?'}_r=${retryKey}`
    : baseImageUrl;

  const showImage = !!(imageUrl && !imageError);

  return { imageUrl, showImage, imageLoaded, retryKey, handleImageLoad, handleImageError };
}
