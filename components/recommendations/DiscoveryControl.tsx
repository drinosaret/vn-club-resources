'use client';

import { useRef } from 'react';

/**
 * How closely the page's popularity spread is matched to the reader's own.
 *
 * The default ranks purely on how well a title fits the reader. Moving off it rebalances the
 * page toward the popularity range their own titles occupy, which necessarily seats some
 * weaker matches higher, so the steps are named for what is gained rather than for a number.
 * It changes the order of the answer, never which titles qualify.
 */

/** One name for the control: the heading and the group label cannot drift apart. */
const DISCOVERY_LABEL = 'How closely the picks match the popularity of your own titles';

export interface DiscoveryStep {
  value: number;
  label: string;
  hint: string;
}

/**
 * The published default is the first step: rank on fit alone. The later steps trade some of
 * that fit for a page weighted toward how well known the reader's own titles are.
 */
export const DISCOVERY_STEPS: DiscoveryStep[] = [
  { value: 0, label: 'Best matches', hint: 'Ranked on fit alone, which tends to favor the best known matches' },
  { value: 0.5, label: 'Mixed', hint: 'Mostly fit, pulled part way toward the popularity of your own titles' },
  { value: 1, label: 'My level', hint: 'Popularity matched to your own titles, at some cost to fit' },
];

interface DiscoveryControlProps {
  /** Undefined follows the site default, which is the same balance as "Best matches". */
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}

function isActive(step: DiscoveryStep, value: number | undefined): boolean {
  // Unset and the default step are the same answer, so the default reads as chosen rather
  // than leaving the row looking untouched.
  if (value === undefined) return step.value === 0;
  return Math.abs(step.value - value) < 0.01;
}

export function DiscoveryControl({ value, onChange }: DiscoveryControlProps) {
  const activeHint = DISCOVERY_STEPS.find((step) => isActive(step, value))?.hint;
  const buttonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // One tab stop for the group; arrows move within it, which is what a radio group is.
  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % DISCOVERY_STEPS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + DISCOVERY_STEPS.length) % DISCOVERY_STEPS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = DISCOVERY_STEPS.length - 1;
    if (next < 0) return;

    event.preventDefault();
    const target = DISCOVERY_STEPS[next];
    onChange(target.value === 0 ? undefined : target.value);
    buttonRefs.current.get(target.value)?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-[color:var(--ink)]">{DISCOVERY_LABEL}</span>

      <div role="radiogroup" aria-label={DISCOVERY_LABEL} className="rc-seg w-fit">
        {DISCOVERY_STEPS.map((step, index) => {
          const active = isActive(step, value);
          return (
            <button
              key={step.value}
              ref={(element) => {
                if (element) buttonRefs.current.set(step.value, element);
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              title={step.hint}
              onClick={() => onChange(step.value === 0 ? undefined : step.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`rc-seg-item ${active ? 'rc-seg-item--on' : ''}`}
            >
              {step.label}
            </button>
          );
        })}
      </div>

      {activeHint ? <p className="rc-why">{activeHint}</p> : null}
    </div>
  );
}
