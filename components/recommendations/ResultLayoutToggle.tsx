'use client';

import { useRef } from 'react';
import { Grid3x3, LayoutGrid, List, Rows3, LucideIcon } from 'lucide-react';

import { RESULT_LAYOUTS, ResultLayout } from '@/lib/recommendation-layout';

/**
 * How the results are drawn, as a group of four.
 *
 * Exactly one is always in force, which is a radio group rather than four toggles: announced as
 * buttons, three of the four would report only that they are not pressed and the choice would
 * never be conveyed as a choice. The neighbouring discovery control is built the same way.
 */

const ICONS: Record<ResultLayout, LucideIcon> = {
  list: List,
  grid: Grid3x3,
  cards: LayoutGrid,
  detail: Rows3,
};

interface ResultLayoutToggleProps {
  layout: ResultLayout;
  onChange: (layout: ResultLayout) => void;
  className?: string;
}

export function ResultLayoutToggle({ layout, onChange, className = '' }: ResultLayoutToggleProps) {
  const buttonRefs = useRef<Map<ResultLayout, HTMLButtonElement>>(new Map());

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % RESULT_LAYOUTS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + RESULT_LAYOUTS.length) % RESULT_LAYOUTS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = RESULT_LAYOUTS.length - 1;
    if (next < 0) return;

    event.preventDefault();
    const target = RESULT_LAYOUTS[next];
    onChange(target.value);
    buttonRefs.current.get(target.value)?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Result layout" className={`rc-seg ${className}`}>
      {RESULT_LAYOUTS.map((option, index) => {
        const Icon = ICONS[option.value];
        const isActive = option.value === layout;
        return (
          <button
            key={option.value}
            ref={(element) => {
              if (element) buttonRefs.current.set(option.value, element);
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={option.label}
            tabIndex={isActive ? 0 : -1}
            title={`${option.label}. ${option.hint}`}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`rc-seg-item rc-seg-item--icon ${isActive ? 'rc-seg-item--on' : ''}`}
          >
            <Icon className="w-4 h-4" />
          </button>
        );
      })}
    </div>
  );
}
