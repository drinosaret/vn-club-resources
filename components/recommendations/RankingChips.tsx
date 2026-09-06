'use client';

import { X } from 'lucide-react';
import { DISCOVERY_STEPS } from './DiscoveryControl';
import { SIGNAL_WEIGHTS, SignalWeights, isDefaultWeights, matchingPreset } from '@/lib/recommendation-weights';

/**
 * The two ranking settings, as chips beside the filter chips.
 *
 * Neither narrows the pool, so neither counts as a filter, and both are otherwise
 * invisible once the panel is shut: a page ranked under a preset looked identical to one
 * ranked under the default.
 */
export function RankingChips({
  weights,
  discovery,
  onClearWeights,
  onClearDiscovery,
  defaults = SIGNAL_WEIGHTS,
}: {
  weights: SignalWeights | null;
  defaults?: SignalWeights;
  discovery: number | undefined;
  onClearWeights: () => void;
  onClearDiscovery: () => void;
}) {
  const chips: React.ReactNode[] = [];
  if (!isDefaultWeights(weights, defaults)) {
    const preset = weights ? matchingPreset(weights, defaults) : null;
    chips.push(
      <Chip key="weights" label={preset ? `Balance: ${preset.label}` : 'Balance: custom'} onRemove={onClearWeights} />,
    );
  }
  if (discovery !== undefined && discovery > 0) {
    const step = DISCOVERY_STEPS.find((entry) => Math.abs(entry.value - discovery) < 0.01);
    chips.push(
      <Chip key="discovery" label={`Discovery: ${step ? step.label : discovery}`} onRemove={onClearDiscovery} />,
    );
  }
  if (chips.length === 0) return null;
  return <>{chips}</>;
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="rc-chip rc-chip--on">
      <span>{label}</span>
      <button type="button" onClick={onRemove} className="rc-chip-btn" aria-label={`Remove ${label}`}>
        <X aria-hidden className="w-3 h-3" />
      </button>
    </span>
  );
}
