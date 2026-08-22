'use client';

import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { Info } from 'lucide-react';

interface StatsSummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext?: string;
  tooltip?: string;
}

function InfoTooltip({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipId = useId();

  const updatePosition = useCallback(() => {
    if (!buttonRef.current || !tooltipRef.current) return;
    const btn = buttonRef.current.getBoundingClientRect();
    const tip = tooltipRef.current.getBoundingClientRect();
    // Center above the button, clamped to viewport edges
    let left = btn.left + btn.width / 2 - tip.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tip.width - 8));
    setPos({ top: btn.top - tip.height - 8, left });
    setPositioned(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setPositioned(false);
      return;
    }
    // Position once tooltip is rendered
    requestAnimationFrame(updatePosition);

    const handleClickOutside = (e: MouseEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isOpen, updatePosition]);

  return (
    <span className="inline-flex">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        aria-describedby={tooltipId}
        className="cursor-help rounded-sm text-gray-400 hover:text-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 dark:hover:text-gray-300"
        aria-label="More info"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {isOpen && (
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className="fixed z-50 px-3 py-2 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded-lg shadow-lg whitespace-normal max-w-[260px] text-center"
          style={{ top: pos.top, left: pos.left, visibility: positioned ? 'visible' : 'hidden' }}
        >
          {text}
        </div>
      )}
    </span>
  );
}

export function StatsSummaryCard({
  icon,
  label,
  value,
  subtext,
  tooltip,
}: StatsSummaryCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none hover:shadow-lg hover:shadow-gray-300/50 dark:hover:shadow-none transition-shadow duration-200">
      {/* The icon sits with the figure rather than with the label. Beside the label it and
          its gap take a third of a card's width in a four-up row, which leaves too little for
          a two-word label: whichever card wraps then drops its figure and its subtext a line
          below the card next to it, and only the boxes stay level. */}
      <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1 mb-2 max-[359px]:min-h-10 max-[359px]:items-start">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <div className="flex items-center gap-2">
        <div className="text-primary-600 dark:text-primary-400">
          {icon}
        </div>
        <div className="text-2xl font-bold text-gray-900 dark:text-white">
          {value}
        </div>
      </div>
      {subtext && (
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {subtext}
        </div>
      )}
    </div>
  );
}
