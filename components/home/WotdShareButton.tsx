'use client';

import { useState, useCallback } from 'react';
import { ShareMenu, type SharePlatform } from '@/components/shared/ShareMenu';
import { ShareToast } from '@/components/shared/ShareToast';
import { stripFurigana, toHiragana } from '@/lib/furigana';
import type { WordOfTheDayData } from '@/lib/word-of-the-day';

interface WotdShareButtonProps {
  data: WordOfTheDayData;
}

function buildShareText(data: WordOfTheDayData): string {
  const word = stripFurigana(data.main_reading.text);
  const reading = toHiragana(data.main_reading.text);
  const meanings = data.definitions[0]?.meanings?.slice(0, 3).join(', ') || '';
  const showReading = reading !== word;

  let text = `${word}`;
  if (showReading) text += ` (${reading})`;
  if (meanings) text += ` - ${meanings}`;
  return text;
}

function getShareUrl(date: string): string {
  return `https://vnclub.org/word-of-the-day?date=${date}`;
}

export function WotdShareButton({ data }: WotdShareButtonProps) {
  const [sharing, setSharing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastIsError, setToastIsError] = useState(false);
  const [canNativeShare] = useState(() =>
    typeof navigator !== 'undefined' && !!navigator.share,
  );

  const shareText = buildShareText(data);
  const shareUrl = getShareUrl(data.date);
  const fullText = `${shareText}\n${shareUrl}`;

  const handleShare = useCallback(async (platform: SharePlatform) => {
    setSharing(true);
    try {
      switch (platform) {
        case 'native':
          await navigator.share({ title: shareText, url: shareUrl });
          break;
        case 'clipboard':
          await navigator.clipboard.writeText(fullText);
          setToastMessage('Copied to clipboard');
          break;
        case 'twitter': {
          const tweetText = encodeURIComponent(shareText);
          const tweetUrl = encodeURIComponent(shareUrl);
          window.open(`https://x.com/intent/tweet?text=${tweetText}&url=${tweetUrl}`, '_blank');
          navigator.clipboard.writeText(fullText).catch(() => {});
          setToastMessage('Copied! Opening X...');
          break;
        }
        case 'reddit': {
          const title = encodeURIComponent(shareText);
          const url = encodeURIComponent(shareUrl);
          window.open(`https://www.reddit.com/submit?title=${title}&url=${url}`, '_blank');
          navigator.clipboard.writeText(fullText).catch(() => {});
          setToastMessage('Copied! Opening Reddit...');
          break;
        }
        case 'open-tab':
          window.open(shareUrl, '_blank');
          break;
      }
    } catch {
      if (platform !== 'native') {
        setToastIsError(true);
        setToastMessage('Failed to share');
      }
    } finally {
      setSharing(false);
    }
  }, [shareText, shareUrl, fullText]);

  const dismissToast = useCallback(() => {
    setToastMessage(null);
    setToastIsError(false);
  }, []);

  return (
    <>
      <ShareMenu
        onShare={handleShare}
        sharing={sharing}
        canNativeShare={canNativeShare}
        hidePlatforms={['open-tab']}
        clipboardLabel="Copy to clipboard"
      />
      <ShareToast message={toastMessage} isError={toastIsError} onDismiss={dismissToast} />
    </>
  );
}
