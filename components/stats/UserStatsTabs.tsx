'use client';

import { memo } from 'react';

export type StatsTabId =
  | 'summary'
  | 'trends'
  | 'novels'
  | 'tags'
  | 'developers'
  | 'publishers'
  | 'staff'
  | 'seiyuu'
  | 'traits';

interface Tab {
  id: StatsTabId;
  label: string;
  count?: number;
}

interface UserStatsTabsProps {
  activeTab: StatsTabId;
  onTabChange: (tab: StatsTabId) => void;
  counts?: {
    novels?: number;
    tags?: number;
    developers?: number;
    publishers?: number;
    staff?: number;
    seiyuu?: number;
    traits?: number;
  };
}

export const UserStatsTabs = memo(function UserStatsTabs({ activeTab, onTabChange, counts }: UserStatsTabsProps) {
  const tabs: Tab[] = [
    {
      id: 'summary',
      label: 'Summary',
    },
    {
      id: 'trends',
      label: 'Trends',
    },
    {
      id: 'novels',
      label: 'Novels',
      count: counts?.novels,
    },
    {
      id: 'tags',
      label: 'Tags',
      count: counts?.tags,
    },
    {
      id: 'traits',
      label: 'Traits',
      count: counts?.traits,
    },
    {
      id: 'staff',
      label: 'Staff',
      count: counts?.staff,
    },
    {
      id: 'seiyuu',
      label: 'Seiyuu',
      count: counts?.seiyuu,
    },
    {
      id: 'developers',
      label: 'Developers',
      count: counts?.developers,
    },
    {
      id: 'publishers',
      label: 'Publishers',
      count: counts?.publishers,
    },
  ];

  return (
    <>
      {/* Desktop: Vertical sidebar */}
      <nav className="hidden md:block w-48 shrink-0" aria-label="Stats navigation">
        <div className="tabs sticky top-20 z-10 flex-col">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`tab w-full justify-between ${isActive ? 'tab--on' : ''}`}
              >
                <span className="flex-1 text-left">{tab.label}</span>
                {tab.count !== undefined && (
                  <span className="tab-count">{tab.count.toLocaleString()}</span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile: every section visible at once.
          A horizontal scroller fitted three of the nine and gave no sign the rest existed,
          which made most of a reader's own stats unfindable on a phone. Wrapped pills cost a
          second row and show all of them. */}
      <nav className="md:hidden mb-4" aria-label="Stats navigation">
        <ul className="tabs">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <li key={tab.id}>
                <button
                  onClick={() => onTabChange(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`tab min-h-9 ${isActive ? 'tab--on' : ''}`}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="tab-count">{tab.count.toLocaleString()}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
});
