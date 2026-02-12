'use client';

import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';

interface MobileFilterPanelProps {
  isExpanded: boolean;
  onToggle: () => void;
  activeFilterCount: number;
  children: React.ReactNode;
}

export function MobileFilterPanel({
  isExpanded,
  onToggle,
  activeFilterCount,
  children,
}: MobileFilterPanelProps) {
  return (
    <div className="lg:hidden mb-4">
      {/* Toggle Bar - always visible on mobile */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3
                   bg-white dark:bg-gray-800 border border-gray-200
                   dark:border-gray-700 rounded-lg transition-colors
                   hover:bg-gray-50 dark:hover:bg-gray-750"
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <span className="font-medium text-gray-700 dark:text-gray-300">
            Filters
          </span>
          {activeFilterCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-semibold rounded-full
                           bg-primary-100 dark:bg-primary-900/50
                           text-primary-700 dark:text-primary-300">
              {activeFilterCount}
            </span>
          )}
        </div>
        <ChevronDown
          className={`w-5 h-5 text-gray-400 transition-transform duration-200
                     ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Collapsible Filter Content */}
      <div
        className={`overflow-hidden transition-[max-height,opacity,margin] duration-300 ease-in-out
                   ${isExpanded ? 'max-h-[2000px] opacity-100 mt-3' : 'max-h-0 opacity-0'}`}
      >
        <div className="bg-white dark:bg-gray-800 rounded-lg border
                       border-gray-200 dark:border-gray-700 flex flex-col max-h-[70vh]">
          {/* Sticky header with close button */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">Filters</span>
            <button
              type="button"
              onClick={onToggle}
              className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              aria-label="Close filters"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable filter content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
            {children}
          </div>

          {/* Sticky footer with Apply button */}
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
            <button
              type="button"
              onClick={onToggle}
              className="w-full py-2.5 bg-primary-600 hover:bg-primary-700
                        text-white font-medium rounded-lg transition-colors"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
