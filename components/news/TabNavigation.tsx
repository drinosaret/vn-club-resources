'use client';

import Link from 'next/link';
import { TAB_LIST } from '@/lib/sample-news-data';
import { skipNextScroll } from '@/components/ScrollToTop';

interface TabNavigationProps {
  activeTab: string;
  date: string;
  sourceCounts?: Record<string, number>;
}

export function TabNavigation({ activeTab, date, sourceCounts }: TabNavigationProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2" role="tablist" aria-label="Filter news by source">
      {TAB_LIST.map((tab) => {
        const isActive = activeTab === tab.slug;
        const count = sourceCounts && tab.slug !== 'all'
          ? sourceCounts[tab.slug === 'recently-added' ? 'vndb' : tab.slug === 'releases' ? 'vndb_release' : tab.slug === 'announcements' ? 'announcement' : tab.slug]
          : tab.slug === 'all' && sourceCounts
            ? Object.values(sourceCounts).reduce((a, b) => a + b, 0)
            : undefined;

        return (
          <Link
            key={tab.slug}
            href={`/news/${tab.slug}/${date}/`}
            onClick={skipNextScroll}
            role="tab"
            aria-selected={isActive}
            className={`
              px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
              ${isActive
                ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200 ring-2 ring-rose-500/50'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }
            `}
          >
            {tab.label}
            {count !== undefined && count > 0 && (
              <span className={`ml-1.5 text-xs ${isActive ? 'text-rose-600 dark:text-rose-300' : 'text-gray-400 dark:text-gray-500'}`}>
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
