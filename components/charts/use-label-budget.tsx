'use client';

import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * How many x-axis labels a plot has room for.
 *
 * A fixed budget is a guess about width, and these charts are drawn everywhere from a phone
 * to a wide column. Six labels fit comfortably at desktop and overprint each other into an
 * unreadable smudge at 320, where the plot is a third as wide. Counting the slots the plot
 * can actually hold means the axis thins itself instead.
 */

/** The widest an axis label gets at the size these charts draw them, plus a readable gap. */
const LABEL_SLOT_PX = 52;

export function useLabelBudget(ref: RefObject<HTMLElement | null>, cap: number): number {
  // Starts at the cap so the server and the first client paint agree; the observer trims it
  // once a real width exists.
  const [budget, setBudget] = useState(cap);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      const width = element.clientWidth;
      if (!width) return;
      setBudget(Math.max(2, Math.min(cap, Math.floor(width / LABEL_SLOT_PX))));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, cap]);

  return budget;
}
