'use client';

import Link from '@/components/Link';
import { TAB_LIST, TAB_SLUGS } from '@/lib/sample-news-data';
import { skipNextScroll } from '@/components/ScrollToTop';

interface TabNavigationProps {
  activeTab: string;
  /**
   * The day the archive tabs link into. Omitted on a view that is not tied to a date, where
   * each tab links to its undated route and resolves the current day for itself.
   */
  date?: string;
  sourceCounts?: Record<string, number>;
}

/**
 * Items carried by a tab for the day on screen. A tab with no news source behind it is
 * absent from TAB_SLUGS and shows no count.
 */
function tabCount(slug: string, sourceCounts?: Record<string, number>): number | undefined {
  if (!sourceCounts) return undefined;
  if (slug === 'all') {
    return Object.values(sourceCounts).reduce((a, b) => a + b, 0);
  }
  const source = TAB_SLUGS[slug];
  return source ? sourceCounts[source] : undefined;
}

export function TabNavigation({ activeTab, date, sourceCounts }: TabNavigationProps) {
  return (
    <div className="tabs" role="tablist" aria-label="Filter news by source">
      {TAB_LIST.map((tab) => {
        const isActive = activeTab === tab.slug;
        const count = tabCount(tab.slug, sourceCounts);
        const href = tab.href ?? (date ? `/news/${tab.slug}/${date}/` : `/news/${tab.slug}/`);

        return (
          <Link
            key={tab.slug}
            href={href}
            onClick={skipNextScroll}
            role="tab"
            aria-selected={isActive}
            className={isActive ? 'tab tab--on' : 'tab'}
          >
            {tab.label}
            {count !== undefined && count > 0 && <span className="tab-count">{count}</span>}
          </Link>
        );
      })}
    </div>
  );
}
