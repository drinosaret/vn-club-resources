'use client';

import { useState, useEffect } from 'react';
import { TabNavigation } from './TabNavigation';
import { DateStrip } from './DateStrip';
import { NewsCard } from './NewsCard';
import { DigestItemCard } from './DigestItemCard';
import { VNOfTheDayBanner } from './VNOfTheDayBanner';
import {
  TAB_LABELS,
  TAB_SLUGS,
  type NewsListItem,
  type NewsListResponse,
} from '@/lib/sample-news-data';
import type { VNOfTheDayData } from '@/lib/vn-of-the-day';

interface NewsDatePageClientProps {
  tab: string;
  date: string;
  initialData: NewsListResponse | null;
  vnOfTheDay?: VNOfTheDayData | null;
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

export function NewsDatePageClient({ tab, date, initialData, vnOfTheDay }: NewsDatePageClientProps) {
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

      {/* Date heading + server clock */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-xl font-bold text-[color:var(--ink)]">
          {formattedDate}
        </h2>
        <UTCClock />
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 rounded-xs border border-[color:var(--rule)] border-l-[3px] border-l-[color:var(--kohaku)] p-3 text-sm text-[color:var(--text-secondary)]">
          {error}
        </div>
      )}

      {/* VN of the Day banner (all tab only) */}
      {tab === 'all' && vnOfTheDay && (
        <div className="mb-6">
          <VNOfTheDayBanner data={vnOfTheDay} />
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
      <p className="py-12 text-center text-sm text-[color:var(--nezu)]">
        No news items for this date
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {sections.map(src => {
        const sectionItems = grouped[src];
        const label = SOURCE_SECTION_LABELS[src] || src;
        return (
          <section key={src}>
            <div className="nw-group">
              <h3 className="nw-group-title">{label}</h3>
              <span className="nameplate nameplate--plain tabular-nums">
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

/** Live UTC clock showing server time */
function UTCClock() {
  const [time, setTime] = useState('');

  useEffect(() => {
    function update() {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('en-US', {
          timeZone: 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      );
    }
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!time) return null;

  return (
    <span
      className="font-mono text-xs tabular-nums text-[color:var(--text-faint)]"
      title="Server time (UTC). News updates daily at midnight UTC."
    >
      {time} UTC
    </span>
  );
}

const EMPTY_LABELS: Record<string, string> = {
  all: 'news',
  'recently-added': 'recently added VNs',
  releases: 'releases',
  rss: 'RSS feed items',
  twitter: 'tweets',
  announcements: 'announcements',
};

/** Empty state when no items for a date + tab */
function EmptyState({ tab, date }: { tab: string; date: string }) {
  const label = EMPTY_LABELS[tab] || 'news';

  return (
    <div className="py-16 text-center">
      <h3 className="font-display text-lg font-bold text-[color:var(--ink)]">
        No {label} for {date}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-[color:var(--nezu)]">
        Try selecting a different date using the date picker above, or check another source tab.
      </p>
    </div>
  );
}
