import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { SharePlatform } from '@/components/shared/ShareMenu';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

interface UseImageShareOptions {
  generateBlob: () => Promise<Blob>;
  shareText: string;
  hashtags?: string;
  filename?: string;
  getShareUrl?: () => Promise<string>;
  title?: string;
}

export function useImageShare({
  generateBlob,
  shareText,
  hashtags,
  filename = 'vn-share.png',
  getShareUrl,
  title,
}: UseImageShareOptions) {
  const [sharing, setSharing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastIsError, setToastIsError] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cachedBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    return () => clearTimeout(toastTimerRef.current);
  }, []);

  // Pre-render the canvas blob so clipboard writes resolve instantly within
  // the user gesture activation window (critical for mobile Chrome).
  // Call this when the share menu opens.
  const prepareBlob = useCallback(() => {
    cachedBlobRef.current = null;
    generateBlob().then(blob => { cachedBlobRef.current = blob; }).catch(() => {});
  }, [generateBlob]);

  // Get blob — use cached version if available, otherwise generate fresh
  const getBlob = useCallback(async (): Promise<Blob> => {
    const cached = cachedBlobRef.current;
    if (cached) {
      cachedBlobRef.current = null;
      return cached;
    }
    return generateBlob();
  }, [generateBlob]);

  const canNativeShare = useMemo(() => {
    if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false;
    try {
      const file = new File([''], 'test.png', { type: 'image/png' });
      return navigator.canShare({ files: [file] });
    } catch {
      return false;
    }
  }, []);

  // Copy image to clipboard. Accepts a Blob or Promise<Blob>.
  // Using the Promise form preserves the user-gesture context on Safari/mobile,
  // where an intermediate `await` (e.g. canvas rendering) would break the gesture
  // chain and cause clipboard.write() to be rejected.
  const copyImageToClipboard = useCallback(async (blobOrPromise: Blob | Promise<Blob>): Promise<boolean> => {
    if (!window.isSecureContext) {
      console.warn('[share] Clipboard API requires HTTPS (secure context)');
      return false;
    }
    if (typeof ClipboardItem === 'undefined') {
      console.warn('[share] ClipboardItem not supported');
      return false;
    }
    try {
      const item = new ClipboardItem({ 'image/png': Promise.resolve(blobOrPromise) });
      await navigator.clipboard.write([item]);
      return true;
    } catch (err) {
      console.warn('[share] clipboard.write failed:', err);
      return false;
    }
  }, []);

  const showToast = useCallback((msg: string, duration: number, isError = false) => {
    clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    setToastIsError(isError);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), duration);
  }, []);

  const share = useCallback(async (platform: SharePlatform) => {
    setSharing(true);
    try {
      // For clipboard-related actions, start the clipboard write SYNCHRONOUSLY
      // within the user gesture (before any await) so mobile browsers don't
      // reject it. ClipboardItem accepts a Promise<Blob> which resolves later.
      if (platform === 'clipboard') {
        const copied = await copyImageToClipboard(getBlob());
        if (copied) {
          showToast('Image copied to clipboard!', 3000);
        } else if (typeof navigator !== 'undefined' && navigator.share) {
          // Clipboard write failed (common on mobile / insecure context) — try native share.
          // Attempt share directly rather than relying on canNativeShare, which may be
          // false when canShare() isn't available even though share() works.
          const blob = await getBlob();
          const file = new File([blob], filename, { type: 'image/png' });
          try {
            await navigator.share({ files: [file] });
            showToast('Shared!', 3000);
          } catch {
            // User cancelled or share with files not supported — no toast
          }
        } else {
          showToast('Clipboard not supported — use the download button instead', 4000, true);
        }
        return;
      }

      // For X, Reddit, and native share, build full text with optional URL + hashtags
      const buildFullText = async () => {
        let url = '';
        if (getShareUrl) {
          try { url = await getShareUrl(); } catch { /* proceed without URL */ }
        }
        const heading = title ? `${title}\n${shareText}` : shareText;
        const parts = [heading];
        if (url) parts.push(url);
        if (hashtags) parts.push(hashtags);
        return parts.join('\n');
      };

      if (platform === 'twitter') {
        // Fully resolve the blob before copying — passing a pending Promise to
        // ClipboardItem can produce blank images when rendering takes too long.
        const [blob, fullText] = await Promise.all([getBlob(), buildFullText()]);
        const copied = await copyImageToClipboard(blob);
        if (!copied) downloadBlob(blob, filename);
        const params = new URLSearchParams({ text: fullText });
        window.open(`https://x.com/intent/tweet?${params.toString()}`, '_blank', 'noopener');
        showToast(
          copied ? 'Image copied — paste it in your tweet!' : 'Image downloaded — upload it to your tweet!',
          5000,
          !copied,
        );
        return;
      }

      if (platform === 'reddit') {
        const [blob, fullText] = await Promise.all([getBlob(), buildFullText()]);
        const copied = await copyImageToClipboard(blob);
        if (!copied) downloadBlob(blob, filename);
        const params = new URLSearchParams({ title: fullText });
        window.open(`https://www.reddit.com/submit?${params.toString()}`, '_blank', 'noopener');
        showToast(
          copied ? 'Image copied — paste it in your post!' : 'Image downloaded — upload it to your post!',
          5000,
          !copied,
        );
        return;
      }

      // native share — needs the resolved blob for File constructor
      const blob = await getBlob();
      const file = new File([blob], filename, { type: 'image/png' });
      try {
        const fullText = await buildFullText();
        await navigator.share({ text: fullText, files: [file] });
        showToast('Shared!', 3000);
      } catch {
        // User cancelled — no toast
      }
    } catch (err) {
      console.error('Share failed:', err);
      showToast('Share failed — try downloading the image instead', 3000, true);
    } finally {
      setSharing(false);
    }
  }, [getBlob, copyImageToClipboard, canNativeShare, shareText, hashtags, filename, getShareUrl, title, showToast]);

  const dismissToast = useCallback(() => {
    clearTimeout(toastTimerRef.current);
    setToastMessage(null);
  }, []);

  return {
    share,
    sharing,
    toastMessage,
    toastIsError,
    dismissToast,
    canNativeShare,
    prepareBlob,
  };
}
