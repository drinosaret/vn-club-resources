'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

export type VNTabId = 'summary' | 'language' | 'tags' | 'traits' | 'characters' | 'stats';

interface VNTabsProps {
  activeTab: VNTabId;
  onTabChange: (tab: VNTabId) => void;
  onTabHover?: (tab: VNTabId) => void;
  tagCount?: number;
  traitCount?: number;
  characterCount?: number;
}

export function VNTabs({ activeTab, onTabChange, onTabHover, tagCount, traitCount, characterCount }: VNTabsProps) {
  const navRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<VNTabId, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);

  const allTabs: Array<{ id: VNTabId; label: string; count?: number; hidden?: boolean }> = [
    { id: 'summary', label: 'Overview' },
    { id: 'stats', label: 'Stats' },
    { id: 'language', label: 'Language' },
    { id: 'tags', label: 'Tags', count: tagCount },
    { id: 'traits', label: 'Traits', count: traitCount },
    { id: 'characters', label: 'Characters', count: characterCount },
  ];
  const tabs = allTabs.filter(t => !t.hidden);

  const updateIndicator = useCallback(() => {
    const tab = tabRefs.current.get(activeTab);
    const nav = navRef.current;
    if (tab && nav) {
      const navRect = nav.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      setIndicatorStyle({
        left: tabRect.left - navRect.left + nav.scrollLeft,
        width: tabRect.width,
      });
      // Auto-scroll active tab into view on mobile (when tab bar overflows)
      if (nav.scrollWidth > nav.clientWidth) {
        tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [activeTab]);

  useEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  // Update indicator on resize
  useEffect(() => {
    const observer = new ResizeObserver(updateIndicator);
    if (navRef.current) observer.observe(navRef.current);
    return () => observer.disconnect();
  }, [updateIndicator]);

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
    <div className="border-b border-gray-200 dark:border-gray-700">
      <nav
        ref={navRef}
        className="relative flex gap-1 overflow-x-auto vn-tabs-scroll scrollbar-none"
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
            className={`relative py-2.5 sm:py-1.5 px-1.5 sm:px-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'text-primary-600 dark:text-primary-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {tab.label}
              {tab.id !== 'summary' && tab.id !== 'stats' && tab.id !== 'language' && (
                <span
                  suppressHydrationWarning
                  className={`text-xs px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center transition-all duration-300 ${
                    tab.count !== undefined
                      ? activeTab === tab.id
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 opacity-100'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 opacity-100'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 opacity-60'
                  }`}
                >
                  {tab.count !== undefined ? tab.count : '\u00B7'}
                </span>
              )}
            </span>
          </button>
        ))}

        {/* Animated underline indicator — inside nav so it scrolls with tabs */}
        {indicatorStyle && (
          <span
            className="absolute bottom-0 h-0.5 bg-primary-600 dark:bg-primary-400 vn-tab-indicator rounded-full"
            style={{
              left: indicatorStyle.left,
              width: indicatorStyle.width,
            }}
          />
        )}
      </nav>
    </div>
  );
}
