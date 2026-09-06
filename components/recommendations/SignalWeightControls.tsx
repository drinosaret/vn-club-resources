'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

import {
  MAX_TOTAL_WEIGHT,
  SIGNAL_KEYS,
  SLIDER_MAX,
  SLIDER_STEP,
  SIGNAL_LABELS,
  SignalKey,
  SignalWeights,
  SIGNAL_WEIGHTS,
  weightPresets,
  contributionPct,
  defaultWeights,
  exceedsTotalLimit,
  isDefaultWeights,
  isEmptyWeights,
  matchingPreset,
  weightTotal,
} from '@/lib/recommendation-weights';

interface SignalWeightControlsProps {
  /** Null while the reader has not tuned anything, which is the published balance. */
  weights: SignalWeights | null;
  onChange: (weights: SignalWeights | null) => void;
  /** The catalogue's published defaults, so the baseline is the engine's rather than this file's. */
  defaults?: SignalWeights;
}

interface SignalMeta {
  hint: string;
  /**
   * Whether this signal gives nearly every candidate the same score.
   *
   * A column that barely varies is inert in a weighted sum: multiplying it by a weight adds
   * close to the same amount to every candidate, so it cannot change their order at any
   * setting. The slider stays, because a link and a preset may still name it, but it is
   * marked rather than left looking like a control that works.
   */
  flat?: boolean;
}

// The labels come from the shared table so a signal is never called one thing here and
// another on its own tab. Nine signals were separated by nine hues; the name beside each
// slider already says which is which, so the hue was carrying nothing.
const SIGNAL_META: Record<SignalKey, SignalMeta> = {
  description: {
    hint: 'How a title describes itself, which it carries whether or not anyone has read it',
  },
  tag: {
    hint: 'Subject matter, weighted toward the tags that single you out',
  },
  similar_games: {
    hint: 'Titles VNDB relates to the ones you rated highest',
  },
  users_also_read: {
    hint: 'What readers of your favorites also read',
  },
  quality: {
    hint: 'The only signal that says nothing about you: lower it to leave consensus out',
  },
  developer: {
    hint: 'Developers and publishers you have rated well',
  },
  staff: {
    flat: true,
    hint: 'Writers, artists and composers you have rated well',
  },
  trait: {
    flat: true,
    hint: 'Character archetypes that recur in what you enjoy',
  },
  seiyuu: {
    flat: true,
    hint: 'Voice actors from titles you rated highly',
  },
};

/**
 * The nine scoring signals, as sliders behind a disclosure.
 *
 * Secondary to the tabs, and deliberately so. A slider can only shift the balance of a
 * blend; a tab shows one signal's own ranking, which is what a reader who wants "titles by
 * studios I like" is actually asking for. Three of the sliders cannot even shift a balance,
 * and are marked where they sit rather than removed: presets and shared links name all nine,
 * and dropping one from the controls would leave a link nothing could reproduce.
 *
 * The share beside each one is what the slider is really setting: the raw number is only
 * meaningful next to the other eight, so doubling everything changes nothing. Showing the
 * share as it is dragged is what makes the trade visible.
 *
 * Nothing here requests anything. The page fetches on Apply, as it does for the filters.
 */
export function SignalWeightControls({ weights, onChange, defaults = SIGNAL_WEIGHTS }: SignalWeightControlsProps) {
  const [isOpen, setIsOpen] = useState(() => !isDefaultWeights(weights, defaults));
  const effective = weights ?? defaultWeights(defaults);
  const total = weightTotal(effective);
  const preset = matchingPreset(effective, defaults);
  const isDefault = isDefaultWeights(weights, defaults);
  const presets = weightPresets(defaults);
  const defaultTotal = weightTotal(defaults);

  const setSignal = (key: SignalKey, value: number) => {
    const next = { ...effective, [key]: value };
    onChange(isDefaultWeights(next, defaults) ? null : next);
  };

  const applyPreset = (presetWeights: SignalWeights) => {
    onChange(isDefaultWeights(presetWeights, defaults) ? null : { ...presetWeights });
  };

  return (
    <div className="border-t border-[color:var(--rule)] pt-3">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="rc-disclose"
      >
        <span className="inline-flex items-center gap-2">
          Tune the signals
          {!isDefault && <span className="rc-badge">{preset ? preset.label : 'Custom'}</span>}
        </span>
        <ChevronDown aria-hidden className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="mt-3 space-y-4">
          <p className="rc-why">
            The Combined list blends nine signals. Move one up and it takes a larger share of the
            blend; the percentages beside the sliders are those shares. To see a single signal on
            its own, open its tab instead: that is a ranking rather than a share.
          </p>

          <div>
            <h3 className="rc-label mb-2">Presets</h3>
            <div className="flex flex-wrap gap-2">
              {presets.map((option) => {
                const isActive = preset?.name === option.name;
                return (
                  <button
                    key={option.name}
                    type="button"
                    onClick={() => applyPreset(option.weights)}
                    aria-pressed={isActive}
                    title={option.description}
                    className={`rc-btn ${isActive ? 'rc-btn--go' : ''}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {preset && <p className="rc-why mt-2">{preset.description}</p>}
          </div>

          <div className="space-y-3">
            {SIGNAL_KEYS.map((key) => {
              const meta = SIGNAL_META[key];
              const value = effective[key];
              const share = contributionPct(value, total);
              return (
                <div key={key}>
                  <div className="flex items-center gap-2 mb-1">
                    <label
                      htmlFor={`signal-weight-${key}`}
                      className="text-sm font-medium text-[color:var(--ink)]"
                    >
                      {SIGNAL_LABELS[key]}
                    </label>
                    <span className="rc-num ml-auto text-xs text-[color:var(--nezu)]">
                      ×{value.toFixed(1)}
                    </span>
                    <span className="rc-num w-10 text-right text-xs font-semibold text-[color:var(--ink)]">
                      {share}%
                    </span>
                  </div>
                  {meta.flat && (
                    <p className="rc-why rc-caution mb-1">
                      Scores nearly every candidate the same, so this one adds the same amount to
                      all of them and moving it changes little. The {SIGNAL_LABELS[key]} tab shows
                      what it does have to say.
                    </p>
                  )}
                  <div className="flex items-center gap-3">
                    <input
                      id={`signal-weight-${key}`}
                      type="range"
                      min={0}
                      max={SLIDER_MAX}
                      step={SLIDER_STEP}
                      value={value}
                      onChange={(event) => setSignal(key, Number(event.target.value))}
                      aria-label={`${SIGNAL_LABELS[key]} weight`}
                      aria-valuetext={`${value.toFixed(1)}, ${share} percent of the score`}
                      className="rc-range flex-1 h-1.5"
                    />
                    <div className="rc-meter w-24 h-2">
                      <div className="rc-meter-fill" style={{ width: `${share}%` }} />
                    </div>
                  </div>
                  <p className="rc-why mt-0.5 text-[color:var(--text-faint)]">{meta.hint}</p>
                </div>
              );
            })}
          </div>

          {isEmptyWeights(effective) && (
            <p className="rc-why rc-caution">
              Every signal is at zero, so nothing is left to rank by. Raise at least one before applying.
            </p>
          )}
          {exceedsTotalLimit(effective) && (
            <p className="rc-why rc-caution">
              These add up to more than {MAX_TOTAL_WEIGHT}, so they will be scaled down together.
              The shares above are what actually applies, and they do not change.
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="rc-why">
              {isDefault
                ? 'Using the default balance'
                : `Total ×${total.toFixed(1)}, against ×${defaultTotal.toFixed(1)} by default`}
            </span>
            <button type="button" onClick={() => onChange(null)} disabled={isDefault} className="rc-btn">
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
