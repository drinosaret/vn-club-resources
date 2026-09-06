'use client';

import { useRef } from 'react';

export type VNTabId = 'summary' | 'language' | 'tags' | 'traits' | 'characters' | 'credits' | 'stats';

interface VNTabsProps {
  activeTab: VNTabId;
  onTabChange: (tab: VNTabId) => void;
  onTabHover?: (tab: VNTabId) => void;
  tagCount?: number;
  traitCount?: number;
  characterCount?: number;
  /** Whether anyone is credited. A title with nobody has no tab rather than an empty one. */
  hasCredits?: boolean;
}

// The tabs whose label carries a count. A tab outside this set has nothing to count, so it
// holds no slot for one.
const COUNTED_TABS = new Set<VNTabId>(['tags', 'traits', 'characters']);

export function VNTabs({ activeTab, onTabChange, onTabHover, tagCount, traitCount, characterCount, hasCredits = false }: VNTabsProps) {
  const tabRefs = useRef<Map<VNTabId, HTMLButtonElement>>(new Map());

  const allTabs: Array<{ id: VNTabId; label: string; count?: number; hidden?: boolean }> = [
    { id: 'summary', label: 'Overview' },
    { id: 'stats', label: 'Stats' },
    { id: 'language', label: 'Language' },
    { id: 'tags', label: 'Tags', count: tagCount },
    { id: 'traits', label: 'Traits', count: traitCount },
    { id: 'characters', label: 'Characters', count: characterCount },
    { id: 'credits', label: 'Credits', hidden: !hasCredits },
  ];
  const tabs = allTabs.filter(t => !t.hidden);

  // Keyboard navigation between tabs
  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    let nextIndex = -1;
    if (e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex >= 0) {
      e.preventDefault();
      const nextTab = tabs[nextIndex];
      onTabChange(nextTab.id);
      tabRefs.current.get(nextTab.id)?.focus();
    }
  };

  return (
    <div className="border-b border-[color:var(--rule)] pb-2">
      <nav
        className="vn-tabs vn-tabs-scroll scrollbar-none"
        aria-label="VN detail sections"
        role="tablist"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(el) => { if (el) tabRefs.current.set(tab.id, el); }}
            onClick={() => onTabChange(tab.id)}
            onMouseEnter={() => onTabHover?.(tab.id)}
            onFocus={() => onTabHover?.(tab.id)}
            onTouchStart={() => onTabHover?.(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            role="tab"
            id={`vn-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`vn-tabpanel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`tab${activeTab === tab.id ? ' tab--on' : ''}`}
          >
            {tab.label}
            {tab.count !== undefined || COUNTED_TABS.has(tab.id) ? (
              <span suppressHydrationWarning className="tab-count">
                {/* The count arrives after the characters do, so the slot is held rather than
                    left to appear and push the rest of the strip sideways. */}
                {tab.count !== undefined
                  ? tab.count
                  : <span className="inline-block w-1.5 h-1.5 bg-current opacity-30 animate-pulse" />}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
    </div>
  );
}
