'use client';

import { BookOpen, Tag, Sparkles, Users, Mic, Building2 } from 'lucide-react';

export type BrowseTab = 'novels' | 'tags' | 'traits' | 'staff' | 'seiyuu' | 'producers';

const TABS: { id: BrowseTab; label: string; icon: React.ElementType }[] = [
  { id: 'novels', label: 'Visual Novels', icon: BookOpen },
  { id: 'tags', label: 'Tags', icon: Tag },
  { id: 'traits', label: 'Traits', icon: Sparkles },
  { id: 'staff', label: 'Staff', icon: Users },
  { id: 'seiyuu', label: 'Seiyuu', icon: Mic },
  { id: 'producers', label: 'Producers', icon: Building2 },
];

interface BrowseTabsProps {
  activeTab: BrowseTab;
  onTabChange: (tab: BrowseTab) => void;
  onTabHover?: (tab: BrowseTab) => void;
}

export function BrowseTabs({ activeTab, onTabChange, onTabHover }: BrowseTabsProps) {
  return (
    <div className="relative border-b border-gray-200 dark:border-gray-700 mb-6">
      <div className="overflow-x-auto">
        <nav className="flex justify-center gap-0 min-w-max" aria-label="Browse tabs">
          {TABS.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => onTabChange(id)}
                onMouseEnter={() => onTabHover?.(id)}
                className={`browse-tab-button flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </nav>
      </div>
      <div className="absolute right-0 top-0 bottom-0 w-8 bg-linear-to-l from-white dark:from-gray-900 to-transparent pointer-events-none md:hidden" />
    </div>
  );
}
