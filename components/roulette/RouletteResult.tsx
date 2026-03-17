'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { getDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import { NSFWImage } from '@/components/NSFWImage';
import { useLocale } from '@/lib/i18n/locale-context';
import { rouletteStrings } from '@/lib/i18n/translations/roulette';
import type { WheelEntry } from './RoulettePageClient';

interface RouletteResultProps {
  result: WheelEntry;
  currentPlayer: string | null;
  mode: 'solo' | 'users';
  onDismiss: () => void;
  hasMorePlayers: boolean;
  allAssigned: boolean;
}

export function RouletteResult({
  result,
  currentPlayer,
  mode,
  onDismiss,
  hasMorePlayers,
  allAssigned,
}: RouletteResultProps) {
  const { preference } = useTitlePreference();
  const locale = useLocale();
  const s = rouletteStrings[locale];
  const title = getDisplayTitle(result, preference);

  return (
    <div className="w-full max-w-xs mx-auto animate-fade-in">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm p-4 text-center shadow-xl">
        {/* Player assignment header */}
        {mode === 'users' && currentPlayer && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            <span className="font-semibold text-violet-600 dark:text-violet-400">{currentPlayer}</span>
            {' '}{s['result.reads']}
          </p>
        )}

        {/* VN cover */}
        {result.imageUrl && (
          <div className="w-24 h-32 mx-auto mb-3 rounded-lg overflow-hidden shadow-md">
            <NSFWImage src={result.imageUrl} alt={title} imageSexual={result.imageSexual ?? undefined} vnId={result.id} className="w-full h-full object-cover" />
          </div>
        )}

        {/* VN title */}
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
          {title}
        </h3>

        {/* Rating */}
        {result.rating != null && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            {s['result.rating'].replace('{rating}', result.rating.toFixed(2))}
          </p>
        )}

        {/* VN detail link */}
        <Link
          href={`/vn/${result.id}/`}
          className="inline-flex items-center gap-1 text-sm text-violet-600 dark:text-violet-400 hover:underline mb-4"
        >
          {s['result.viewDetails']}
          <ExternalLink className="w-3 h-3" />
        </Link>

        {/* Action button */}
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          {allAssigned ? (
            <p className="text-sm text-green-600 dark:text-green-400 font-medium">
              {s['result.allAssigned']}
            </p>
          ) : (
            <button
              onClick={onDismiss}
              className="px-6 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors"
            >
              {mode === 'users' && hasMorePlayers ? s['spin.nextPlayer'] : s['spin.spinAgain']}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
