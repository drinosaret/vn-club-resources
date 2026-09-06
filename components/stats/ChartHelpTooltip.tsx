'use client';

import { useRef, useCallback, useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface ChartHelpTooltipProps {
  text: string;
}

export function ChartHelpTooltip({ text }: ChartHelpTooltipProps) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  const updatePosition = useCallback(() => {
    const el = iconRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const tooltipW = 256; // w-64
    const margin = 12;

    // Use the tighter of viewport or parent card bounds
    let boundsL = margin;
    let boundsR = window.innerWidth - margin;
    const card = el.closest<HTMLElement>('.st-card');
    if (card) {
      const cr = card.getBoundingClientRect();
      boundsL = Math.max(boundsL, cr.left + margin);
      boundsR = Math.min(boundsR, cr.right - margin);
    }

    const left = center - tooltipW / 2;
    const right = center + tooltipW / 2;
    if (left < boundsL) setShift(boundsL - left);
    else if (right > boundsR) setShift(boundsR - right);
    else setShift(0);
  }, []);

  return (
    <span
      ref={iconRef}
      className="relative inline-flex align-middle ml-1.5 group/help"
      onPointerEnter={updatePosition}
    >
      <HelpCircle className="w-3.5 h-3.5 text-[color:var(--text-faint)] hover:text-[color:var(--nezu)] cursor-help" />
      <span
        className="st-tip on-box pointer-events-none absolute left-1/2 top-full mt-1.5 w-64 px-3 py-2 opacity-0 group-hover/help:opacity-100 transition-opacity z-50"
        style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
      >
        {text}
        <span
          className="absolute bottom-full left-1/2 border-4 border-transparent border-b-[color:var(--box)]"
          style={{ transform: `translateX(calc(-50% - ${shift}px))` }}
        />
      </span>
    </span>
  );
}
