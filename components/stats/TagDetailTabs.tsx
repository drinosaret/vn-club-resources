'use client';

import {
  LayoutDashboard,
  BookOpen,
  Tags,
  Users,
} from 'lucide-react';

export type TagTabId = 'summary' | 'novels' | 'similar-tags' | 'similar-traits';

interface Tab {
  id: TagTabId;
  label: string;
  icon: React.ReactNode;
  count?: number;
}

interface TagDetailTabsProps {
  activeTab: TagTabId;
  onTabChange: (tab: TagTabId) => void;
  counts?: {
    novels?: number;
    similarTags?: number;
    traits?: number;
  };
  hideTabs?: TagTabId[];
}

export function TagDetailTabs({ activeTab, onTabChange, counts, hideTabs = [] }: TagDetailTabsProps) {
  const allTabs: Tab[] = [
    {
      id: 'summary',
      label: 'Summary',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'novels',
      label: 'Novels',
      icon: <BookOpen className="w-4 h-4" />,
      count: counts?.novels,
    },
    {
      id: 'similar-tags',
      label: 'Similar Tags',
      icon: <Tags className="w-4 h-4" />,
      count: counts?.similarTags,
    },
    {
      id: 'similar-traits',
      label: 'Similar Traits',
      icon: <Users className="w-4 h-4" />,
      count: counts?.traits,
    },
  ];

  const tabs = allTabs.filter(tab => !hideTabs.includes(tab.id));

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
      <nav className="-mb-px flex gap-1 flex-wrap sm:flex-nowrap overflow-x-auto" aria-label="Tabs">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                group inline-flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors
                ${
                  isActive
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 dark:hover:border-gray-600'
                }
              `}
            >
              <span className={isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'}>
                {tab.icon}
              </span>
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={`
                    ml-1 py-0.5 px-2 rounded-full text-xs
                    ${
                      isActive
                        ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    }
                  `}
                >
                  {tab.count.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
