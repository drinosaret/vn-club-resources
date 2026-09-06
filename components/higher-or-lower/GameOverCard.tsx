'use client';

import { useState } from 'react';
import { Check, Copy, RotateCcw, Share2 } from 'lucide-react';
import { SITE_URL } from '@/lib/metadata-utils';
import { METRICS, type MetricKey } from './metrics';

interface GameOverCardProps {
  streak: number;
  best: number;
  isBest: boolean;
  mode: MetricKey;
  onRestart: () => void;
}

export function GameOverCard({ streak, best, isBest, mode, onRestart }: GameOverCardProps) {
  const [copied, setCopied] = useState(false);
  // No score in the URL: the streak rides in the text only, and nothing about the
  // player is stored or sent anywhere.
  const shareText = `Streak of ${streak} on VN Higher or Lower (${METRICS[mode].label}). Can you beat it? ${SITE_URL}/higher-or-lower/`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable
    }
  };

  const share = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ text: shareText });
        return;
      } catch {
        // user dismissed or share failed; fall through to copy
      }
    }
    copy();
  };

  return (
    <div className="toy-panel mx-auto mt-5 w-full max-w-sm p-5 text-center">
      <p className="toy-label">Game over</p>
      <p className="mt-2 font-mono text-4xl font-medium tabular-nums text-[color:var(--ink)]">{streak}</p>
      <p className="text-sm text-[color:var(--nezu)]">{streak === 1 ? 'correct guess' : 'correct guesses'}</p>
      {isBest && streak > 0 ? (
        <p className="mt-2 text-sm font-medium text-[color:var(--kohaku-text)]">New best!</p>
      ) : (
        <p className="mt-2 text-sm text-[color:var(--nezu)]">Best: {best}</p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={onRestart}
          className="toy-btn toy-btn--go toy-btn--wide"
        >
          <RotateCcw className="h-4 w-4" /> Play again
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={share}
            className="toy-btn flex-1"
          >
            <Share2 className="h-4 w-4" /> Share
          </button>
          <button
            type="button"
            onClick={copy}
            className="toy-btn flex-1"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
