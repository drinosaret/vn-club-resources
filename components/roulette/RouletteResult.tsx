'use client';

import Link from '@/components/Link';
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

  // The name is set into the label at its placeholder rather than placed beside it, because a
  // label that attaches a particle straight to the name leaves no room for a separator: the
  // spacing belongs to the translated string. A label with no placeholder takes the name first.
  const readsLabel = s['result.reads'];
  const readsAt = readsLabel.indexOf('{player}');
  const readsBefore = readsAt >= 0 ? readsLabel.slice(0, readsAt) : '';
  const readsAfter = readsAt >= 0 ? readsLabel.slice(readsAt + '{player}'.length) : ` ${readsLabel}`;

  return (
    <div className="w-full max-w-xs mx-auto animate-fade-in">
      <div className="toy-panel p-4 text-center">
        {/* Player assignment header */}
        {mode === 'users' && currentPlayer && (
          <p className="mb-3 text-sm text-[color:var(--nezu)]">
            {readsBefore}
            <span className="font-mono font-medium text-[color:var(--kohaku-text)]">{currentPlayer}</span>
            {readsAfter}
          </p>
        )}

        {/* VN cover */}
        {result.imageUrl && (
          <div className="toy-thumb w-24 h-32 mx-auto mb-3">
            <NSFWImage src={result.imageUrl} alt={title} imageSexual={result.imageSexual ?? undefined} vnId={result.id} className="w-full h-full object-cover" compact />
          </div>
        )}

        {/* VN title */}
        <h3 className="toy-pick-title mb-1">{title}</h3>

        {/* Rating */}
        {result.rating != null && (
          <p className="mb-3 font-mono text-sm tabular-nums text-[color:var(--nezu)]">
            {s['result.rating'].replace('{rating}', result.rating.toFixed(2))}
          </p>
        )}

        {/* VN detail link */}
        <Link
          href={`/vn/${result.id}/`}
          className="sec-more mb-4"
        >
          {s['result.viewDetails']}
          <ExternalLink className="w-3 h-3" />
        </Link>

        {/* Action button */}
        <div className="mt-3 pt-3 border-t border-[color:var(--rule)]">
          {allAssigned ? (
            <p className="text-sm font-medium text-[color:var(--ai)]">
              {s['result.allAssigned']}
            </p>
          ) : (
            <button
              onClick={onDismiss}
              className="toy-btn toy-btn--go "
            >
              {mode === 'users' && hasMorePlayers ? s['spin.nextPlayer'] : s['spin.spinAgain']}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
