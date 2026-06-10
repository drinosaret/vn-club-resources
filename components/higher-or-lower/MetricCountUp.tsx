'use client';

import { useEffect, useRef, useState } from 'react';

interface MetricCountUpProps {
  value: number;
  durationMs?: number;
  onComplete?: () => void;
}

// Animates 0 -> value with an ease-out cubic, then fires onComplete exactly once.
// onComplete is held in a ref so a parent re-render does not restart the animation.
export function MetricCountUp({ value, durationMs = 750, onComplete }: MetricCountUpProps) {
  const [display, setDisplay] = useState(0);
  const cb = useRef(onComplete);

  // Keep the latest callback without restarting the animation on each parent render.
  useEffect(() => {
    cb.current = onComplete;
  });

  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    let fired = false;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(eased * value));
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else if (!fired) {
        fired = true;
        setDisplay(value);
        cb.current?.();
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <>{display.toLocaleString()}</>;
}
