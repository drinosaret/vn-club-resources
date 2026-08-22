'use client';

import { memo } from 'react';
import {
  LayoutDashboard,
  TrendingUp,
  BookOpen,
  Tags,
  Building2,
  Mic2,
  Newspaper,
  Pen,
  Heart,
} from 'lucide-react';

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
  icon: React.ReactNode;
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
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'trends',
      label: 'Trends',
      icon: <TrendingUp className="w-4 h-4" />,
    },
    {
      id: 'novels',
      label: 'Novels',
      icon: <BookOpen className="w-4 h-4" />,
      count: counts?.novels,
    },
    {
      id: 'tags',
      label: 'Tags',
      icon: <Tags className="w-4 h-4" />,
      count: counts?.tags,
    },
    {
      id: 'traits',
      label: 'Traits',
      icon: <Heart className="w-4 h-4" />,
      count: counts?.traits,
    },
    {
      id: 'staff',
      label: 'Staff',
      icon: <Pen className="w-4 h-4" />,
      count: counts?.staff,
    },
    {
      id: 'seiyuu',
      label: 'Seiyuu',
      icon: <Mic2 className="w-4 h-4" />,
      count: counts?.seiyuu,
    },
    {
      id: 'developers',
      label: 'Developers',
      icon: <Building2 className="w-4 h-4" />,
      count: counts?.developers,
    },
    {
      id: 'publishers',
      label: 'Publishers',
      icon: <Newspaper className="w-4 h-4" />,
      count: counts?.publishers,
    },
  ];

  return (
    <>
      {/* Desktop: Vertical sidebar */}
      <nav className="hidden md:block w-48 shrink-0" aria-label="Stats navigation">
        <div className="sticky top-20 z-10 space-y-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left
                  ${
                    isActive
                      ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
                  }
                `}
              >
                <span className={isActive ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400'}>
                  {tab.icon}
                </span>
                <span className="flex-1">{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`
                      py-0.5 px-2 rounded-full text-xs
                      ${
                        isActive
                          ? 'bg-primary-200 text-primary-700 dark:bg-primary-800/50 dark:text-primary-300'
                          : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                      }
                    `}
                  >
                    {tab.count.toLocaleString()}
                  </span>
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
        <ul className="flex flex-wrap gap-1.5">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <li key={tab.id}>
                <button
                  onClick={() => onTabChange(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`
                    inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors
                    ${
                      isActive
                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                        : 'border-gray-200 text-gray-600 hover:border-primary-400 hover:text-primary-700 dark:border-gray-700 dark:text-gray-400 dark:hover:text-primary-300'
                    }
                  `}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="tabular-nums text-[11px] text-gray-400 dark:text-gray-500">
                      {tab.count.toLocaleString()}
                    </span>
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
