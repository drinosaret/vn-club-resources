'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { HelpCircle } from 'lucide-react';

interface ChartHelpTooltipProps {
  text: string;
}

export function ChartHelpTooltip({ text }: ChartHelpTooltipProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ style: React.CSSProperties; arrowLeft: number } | null>(null);

  const showTooltip = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const tooltipWidth = 256; // w-64
    const margin = 12;
    const vw = window.innerWidth;
    const centerX = rect.left + rect.width / 2;

    if (vw < tooltipWidth + margin * 2 + 20) {
      setPos({
        style: {
          position: 'fixed',
          left: `${margin}px`,
          right: `${margin}px`,
          top: `${rect.bottom + 4}px`,
        },
        arrowLeft: centerX - margin,
      });
    } else {
      let left = centerX - tooltipWidth / 2;
      left = Math.max(margin, Math.min(left, vw - tooltipWidth - margin));
      setPos({
        style: {
          position: 'fixed',
          left: `${left}px`,
          top: `${rect.bottom + 4}px`,
          width: `${tooltipWidth}px`,
        },
        arrowLeft: centerX - left,
      });
    }
  }, []);

  const hideTooltip = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!pos) return;
    const dismiss = () => hideTooltip();
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        hideTooltip();
      }
    };
    window.addEventListener('scroll', dismiss, { capture: true, passive: true });
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      window.removeEventListener('scroll', dismiss, { capture: true });
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [pos, hideTooltip]);

  return (
    <span className="inline-flex ml-1">
      <button
        ref={ref}
        type="button"
        onClick={() => pos ? hideTooltip() : showTooltip()}
        className="group"
        aria-label="Chart info"
      >
        <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help" />
      </button>
      {pos && (
        <div
          className="p-2 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded shadow-lg pointer-events-none z-50"
          style={pos.style}
        >
          {text}
          <div
            className="absolute bottom-full mb-[-1px] border-4 border-transparent border-b-gray-900 dark:border-b-gray-700"
            style={{ left: `${pos.arrowLeft}px`, transform: 'translateX(-50%)' }}
          />
        </div>
      )}
    </span>
  );
}
