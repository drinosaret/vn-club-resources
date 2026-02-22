'use client';

import { Newspaper } from 'lucide-react';
import { TabNavigation } from './TabNavigation';
import { DateStrip } from './DateStrip';
import { NewsCard } from './NewsCard';
import { DigestItemCard } from './DigestItemCard';
import {
  TAB_LABELS,
  TAB_SLUGS,
  type NewsListItem,
  type NewsListResponse,
  newsSources,
} from '@/lib/sample-news-data';

interface NewsDatePageClientProps {
  tab: string;
  date: string;
  initialData: NewsListResponse | null;
}

/** Source display order for the "all" tab */
const SOURCE_ORDER = ['vndb_release', 'vndb', 'rss', 'twitter', 'announcement'] as const;

/** Source labels for section headers */
const SOURCE_SECTION_LABELS: Record<string, string> = {
  vndb: 'Recently Added to VNDB',
  vndb_release: 'VN Releases',
  rss: 'RSS Feeds',
  twitter: 'Twitter',
  announcement: 'Announcements',
};

/** Whether a source uses the DigestItemCard vs NewsCard */
function isVndbSource(source: string): boolean {
  return source === 'vndb' || source === 'vndb_release';
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function NewsDatePageClient({ tab, date, initialData }: NewsDatePageClientProps) {
  const items = initialData?.items ?? [];
  const sourceCounts = initialData?.sources ?? {};
  const formattedDate = formatDate(date);
  const error = initialData?.error;

  return (
    <div>
      {/* Tab navigation */}
      <div className="mb-4">
        <TabNavigation activeTab={tab} date={date} sourceCounts={sourceCounts} />
      </div>

      {/* Date strip */}
      <div className="mb-6">
        <DateStrip currentDate={date} tab={tab} />
      </div>

      {/* Date heading */}
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        {formattedDate}
      </h2>

      {/* Error state */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 text-sm">
          {error}
        </div>
      )}

      {/* Content */}
      {items.length === 0 && !error ? (
        <EmptyState tab={tab} date={formattedDate} />
      ) : tab === 'all' ? (
        <AllSourcesView items={items} sourceCounts={sourceCounts} />
      ) : isVndbSource(TAB_SLUGS[tab] ?? '') ? (
        <VndbGridView items={items} />
      ) : (
        <GridView items={items} />
      )}
    </div>
  );
}

/** "All" tab: group items by source with section headers */
function AllSourcesView({ items, sourceCounts }: { items: NewsListItem[]; sourceCounts: Record<string, number> }) {
  // Group by source
  const grouped: Record<string, NewsListItem[]> = {};
  for (const item of items) {
    const src = item.source;
    if (!grouped[src]) grouped[src] = [];
    grouped[src].push(item);
  }

  // Render in order, only sources that have items
  const sections = SOURCE_ORDER.filter(src => grouped[src]?.length);

  if (sections.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
          <Newspaper className="w-8 h-8 text-gray-400" />
        </div>
        <p className="text-gray-500 dark:text-gray-400">No news items for this date</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {sections.map(src => {
        const sectionItems = grouped[src];
        const label = SOURCE_SECTION_LABELS[src] || src;
        const sourceConfig = newsSources.find(s => s.id === src);

        return (
          <section key={src}>
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                {label}
              </h3>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium ${sourceConfig?.color ?? ''} ${sourceConfig?.darkColor ?? ''}`}>
                {sectionItems.length} {sectionItems.length === 1 ? 'item' : 'items'}
              </span>
            </div>
            {isVndbSource(src) ? (
              <VndbGridView items={sectionItems} />
            ) : (
              <GridView items={sectionItems} />
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Responsive grid layout for VNDB sources */
function VndbGridView({ items }: { items: NewsListItem[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-4">
      {items.map(item => (
        <div key={item.id} className="w-full md:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.6667rem)]">
          <DigestItemCard item={item as any} />
        </div>
      ))}
    </div>
  );
}

/** Responsive grid layout for RSS/Twitter/Announcements */
function GridView({ items }: { items: NewsListItem[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-4">
      {items.map(item => (
        <div key={item.id} className="w-full md:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.6667rem)]">
          <NewsCard item={item} />
        </div>
      ))}
    </div>
  );
}

/** Empty state when no items for a date + tab */
function EmptyState({ tab, date }: { tab: string; date: string }) {
  const label = TAB_LABELS[tab] || 'news';

  return (
    <div className="text-center py-16">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
        <Newspaper className="w-10 h-10 text-gray-400" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        No {label.toLowerCase()} for {date}
      </h3>
      <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
        Try selecting a different date using the date picker above, or check another source tab.
      </p>
    </div>
  );
}
