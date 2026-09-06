'use client';

import { useId } from 'react';
import { ChevronDown, X } from 'lucide-react';

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
  const panelId = useId();

  return (
    <div className="lg:hidden mb-4">
      {/* Toggle Bar - always visible on mobile */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className="bw-select w-full flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <span className="bw-label">Filters</span>
          {activeFilterCount > 0 && (
            <span className="nameplate">{activeFilterCount}</span>
          )}
        </div>
        <ChevronDown
          className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Collapsible Filter Content */}
      {/* Clipping the panel keeps its controls in the tab order and in the accessibility
          tree, so the collapsed state is marked inert as well as hidden. */}
      <div
        id={panelId}
        inert={!isExpanded}
        className={`overflow-hidden transition-[max-height,opacity,margin] duration-300 ease-in-out
                   ${isExpanded ? 'max-h-[2000px] opacity-100 mt-3' : 'max-h-0 opacity-0'}`}
      >
        <div className="bw-panel flex flex-col max-h-[70vh]">
          {/* Sticky header with close button */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[color:var(--rule)] shrink-0">
            <span className="bw-label">Filters</span>
            <button
              type="button"
              onClick={onToggle}
              className="bw-chip-btn p-1 hit-24"
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
          <div className="px-4 py-3 border-t border-[color:var(--rule)] shrink-0">
            <button
              type="button"
              onClick={onToggle}
              className="bw-action w-full py-2.5"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
