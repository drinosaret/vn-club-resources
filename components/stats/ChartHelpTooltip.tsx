'use client';

import { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';

interface ChartHelpTooltipProps {
  text: string;
}

export function ChartHelpTooltip({ text }: ChartHelpTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative">
      <button
        ref={ref}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group"
        aria-label="Chart info"
      >
        <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help" />
        <div
          className={`absolute left-0 top-full mt-1 w-64 p-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded shadow-lg transition-opacity pointer-events-none z-30 ${
            isOpen
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          {text}
        </div>
      </button>
    </div>
  );
}
