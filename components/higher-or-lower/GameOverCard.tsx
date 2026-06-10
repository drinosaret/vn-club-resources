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
    <div className="mx-auto mt-5 w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-lg dark:border-gray-700 dark:bg-gray-800">
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Game over</p>
      <p className="mt-1 text-4xl font-extrabold tabular-nums text-gray-900 dark:text-white">{streak}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400">{streak === 1 ? 'correct guess' : 'correct guesses'}</p>
      {isBest && streak > 0 ? (
        <p className="mt-2 text-sm font-semibold text-amber-600 dark:text-amber-400">New best!</p>
      ) : (
        <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">Best: {best}</p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={onRestart}
          className="flex items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700"
        >
          <RotateCcw className="h-4 w-4" /> Play again
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={share}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/50"
          >
            <Share2 className="h-4 w-4" /> Share
          </button>
          <button
            type="button"
            onClick={copy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/50"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
