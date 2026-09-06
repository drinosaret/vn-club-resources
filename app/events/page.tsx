import type { Metadata } from 'next';
import {
  generatePageMetadata,
  SITE_URL,
  safeJsonLdStringify,
  generateBreadcrumbJsonLd,
} from '@/lib/metadata-utils';
import Link from '@/components/Link';
import { getEventsForMonth, getUpcomingEvents, type EventItem } from '@/lib/events';
import EventsCalendar from '@/components/events/EventsCalendar';
import UpcomingList from '@/components/events/UpcomingList';
import { DiscordCTA } from '@/components/shared/DiscordCTA';

// Render fresh each request: the calendar reflects now-relative recurring
// events plus bot/admin-driven rows, so a stale prerender would show nothing.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = generatePageMetadata({
  title: 'Visual Novel Club Events and Calendar',
  description:
    'Community calendar for the VN Club: VN of the Month, VN of the Season, the weekly Movie Night, and the roudoku session where the club reads a very short visual novel aloud together.',
  path: '/events/',
});

const breadcrumbJsonLd = generateBreadcrumbJsonLd([
  { name: 'Home', path: '/' },
  { name: 'Events', path: '/events/' },
]);

function absoluteUrl(url: string | null): string | undefined {
  if (!url) return undefined;
  return url.startsWith('/') ? `${SITE_URL}${url}` : url;
}

function buildEventsJsonLd(events: EventItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'VN Club Events & Calendar',
    description:
      'Upcoming VN Club events: VN of the Month, VN of the Season, weekly Movie Night and Roudoku, and special events.',
    url: `${SITE_URL}/events/`,
    isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: events.length,
      itemListElement: events.map((e, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Event',
          name: e.title,
          startDate: e.all_day ? e.start_at.slice(0, 10) : e.start_at,
          ...(e.end_at && { endDate: e.all_day ? e.end_at.slice(0, 10) : e.end_at }),
          ...(e.image_url && { image: e.image_url }),
          ...(absoluteUrl(e.url) && { url: absoluteUrl(e.url) }),
          eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
        },
      })),
    },
  };
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  let selectedDate: string | null = null;
  // Deep links: ?date=YYYY-MM-DD opens that month + the day overview;
  // ?month=YYYY-MM just opens that month.
  if (sp?.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)) {
    const [y, m] = sp.date.split('-').map(Number);
    year = y;
    month = m;
    selectedDate = sp.date;
  } else if (sp?.month && /^\d{4}-\d{2}$/.test(sp.month)) {
    const [y, m] = sp.month.split('-').map(Number);
    year = y;
    month = m;
  }

  const [monthEvents, upcoming] = await Promise.all([
    getEventsForMonth(year, month),
    getUpcomingEvents(8),
  ]);

  const jsonLd = [buildEventsJsonLd(upcoming), breadcrumbJsonLd];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <header className="mb-8">
          <h1 className="sec-title">Events &amp; Calendar</h1>
          <p className="mt-3 max-w-2xl text-sm text-[color:var(--text-secondary)]">
            VN of the Month, VN of the Season, weekly Movie Night and Roudoku, and special events
            for the VN Club community. All times shown in your local timezone.
          </p>
          <p className="mt-2 text-sm text-[color:var(--nezu)]">
            Everything the club has already read is in the{' '}
            <Link
              href="/events/history/"
              className="text-[color:var(--ai)] underline underline-offset-2"
            >
              archive of past picks
            </Link>
            .
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <EventsCalendar
              initialYear={year}
              initialMonth={month}
              initialEvents={monthEvents}
              initialSelectedDate={selectedDate}
            />
          </div>
          <aside className="lg:col-span-1">
            <h2 className="rel-group-title">Upcoming</h2>
            <UpcomingList events={upcoming} />
          </aside>
        </div>

        <div className="mt-10">
          <DiscordCTA
            variant="banner"
            title="Join the server"
            description="These events all happen in our Discord. Join to nominate, vote, and take part."
          />
        </div>
      </main>
    </>
  );
}
