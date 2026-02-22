'use client';

import { useRef, useEffect, useCallback } from 'react';

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
  const indicatorRef = useRef<HTMLSpanElement>(null);

  const updateIndicatorRef = useRef<() => void>(() => {});

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
    const indicator = indicatorRef.current;
    if (tab && nav && indicator) {
      const navRect = nav.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      const left = tabRect.left - navRect.left + nav.scrollLeft;

      indicator.style.transform = `translateX(${left}px)`;
      indicator.style.width = `${tabRect.width}px`;


    }
  }, [activeTab]);

  updateIndicatorRef.current = updateIndicator;

  useEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  // Update indicator on resize — observer created once, uses ref for latest callback
  useEffect(() => {
    const observer = new ResizeObserver(() => updateIndicatorRef.current());
    if (navRef.current) observer.observe(navRef.current);
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
                  className={`text-xs px-1.5 py-0.5 rounded-full min-w-6 text-center transition-all duration-300 ${
                    tab.count !== undefined
                      ? activeTab === tab.id
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 opacity-100'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 opacity-100'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 opacity-60'
                  }`}
                >
                  {tab.count !== undefined ? tab.count : <span className="inline-block w-3 h-3 rounded-full bg-gray-200 dark:bg-gray-600 animate-pulse" />}
                </span>
              )}
            </span>
          </button>
        ))}

        {/* Underline indicator — inside nav so it scrolls with tabs */}
        <span
          ref={indicatorRef}
          className="absolute bottom-0 left-0 h-0.5 bg-primary-600 dark:bg-primary-400 rounded-full"
        />
      </nav>
    </div>
  );
}
