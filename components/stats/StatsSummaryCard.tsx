'use client';

import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { Info } from 'lucide-react';

interface StatsSummaryCardProps {
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
    <span className="inline-flex align-middle ml-1.5">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        aria-describedby={tooltipId}
        className="cursor-help rounded-xs text-[color:var(--text-faint)] hover:text-[color:var(--nezu)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        aria-label="More info"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {isOpen && (
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className="st-tip on-box fixed z-50 px-3 py-2 whitespace-normal max-w-[260px] text-center"
          style={{ top: pos.top, left: pos.left, visibility: positioned ? 'visible' : 'hidden' }}
        >
          {text}
        </div>
      )}
    </span>
  );
}

export function StatsSummaryCard({
  label,
  value,
  subtext,
  tooltip,
}: StatsSummaryCardProps) {
  return (
    <div className="st-card p-5">
      {/* A label of two words wraps to a second line on a narrow screen. The floor keeps the
          figures in a row level with each other rather than letting the card that wrapped
          push its own figure a line below its neighbours. */}
      <span className="fig-label max-[359px]:min-h-8">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <span className="fig-value">{value}</span>
      {subtext && <span className="fig-delta">{subtext}</span>}
    </div>
  );
}
