import type { Metadata } from 'next';
import {
  generatePageMetadata,
  SITE_URL,
  safeJsonLdStringify,
  generateBreadcrumbJsonLd,
} from '@/lib/metadata-utils';
import Link from '@/components/Link';
import { getClubPickHistory, type EventItem } from '@/lib/events';
import { groupPicksByYear, pickPeriodLabel, stripTypeLabel } from '@/lib/club-history';
import { PickHistoryRow } from '@/components/events/PickHistoryRow';
import { DiscordCTA } from '@/components/shared/DiscordCTA';

// Rendered per request: the archive comes from an endpoint whose availability is not
// guaranteed at build time, and an endpoint that is not there yet reads as an empty list.
export const dynamic = 'force-dynamic';

const PATH = '/events/history/';

// The endpoint's own ceiling. The archive grows by about one row a week, so this
// holds for years; the page states plainly when it has stopped being everything.
const MAX_PICKS = 200;

export const metadata: Metadata = generatePageMetadata({
  title: 'Past Club Picks: Every Pick So Far',
  description:
    'Everything the club has picked together, newest first: the monthly and seasonal visual novels, the weekly read-aloud and Movie Night, each with its cover, date and page.',
  path: PATH,
});

const breadcrumbJsonLd = generateBreadcrumbJsonLd([
  { name: 'Home', path: '/' },
  { name: 'Events', path: '/events/' },
  { name: 'Past Picks', path: PATH },
]);

function absoluteUrl(url: string | null): string | undefined {
  if (!url) return undefined;
  return url.startsWith('/') ? `${SITE_URL}${url}` : url;
}

function buildItemListJsonLd(items: EventItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Past VN Club Picks',
    description:
      'Visual novels and films the club has picked, from the monthly and seasonal votes, the weekly read-aloud and Movie Night.',
    url: `${SITE_URL}${PATH}`,
    numberOfItems: items.length,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': item.event_type === 'movie_night' ? 'Movie' : 'VideoGame',
        name: stripTypeLabel(item.title_romaji || item.title, item.event_type),
        ...(item.title_jp && {
          alternateName: stripTypeLabel(item.title_jp, item.event_type),
        }),
        ...(absoluteUrl(item.url) && { url: absoluteUrl(item.url) }),
        ...(item.image_url && { image: item.image_url }),
      },
    })),
  };
}

export default async function ClubPickHistoryPage() {
  // Read for the request rather than held: the page is dynamic precisely because the
  // archive's endpoint may not answer at build time, and an hour-old empty answer would
  // outlive the reason for asking again.
  const { events, total } = await getClubPickHistory(MAX_PICKS, 0, 60);
  const groups = groupPicksByYear(events);
  const truncated = total > events.length;
  const latest = events[0];

  return (
    <div className="min-h-[80vh] px-4 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(breadcrumbJsonLd) }}
      />
      {events.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(buildItemListJsonLd(events)) }}
        />
      )}

      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8">
          <h1 className="sec-title">Past Club Picks</h1>
          <p className="mt-3 text-sm text-[color:var(--text-secondary)]">
            Everything the club has picked together, newest first. The monthly and seasonal picks
            are voted on by members and read over the period they cover, the weekly roudoku is
            one very short visual novel read aloud in a single sitting, and Movie Night is the
            Saturday screening.
          </p>
          <p className="mt-2 text-sm text-[color:var(--nezu)]">
            What is coming next is on the{' '}
            <Link href="/events/" className="text-[color:var(--ai)] underline underline-offset-2">
              events calendar
            </Link>
            .
          </p>
        </header>

        {events.length === 0 ? (
          <p className="panel p-6 text-center text-sm text-[color:var(--nezu)]">
            No picks have been recorded yet. The{' '}
            <Link href="/events/" className="underline underline-offset-2">
              calendar
            </Link>{' '}
            has what is scheduled.
          </p>
        ) : (
          <>
            <p className="mb-6 font-mono text-xs tracking-wide text-[color:var(--nezu)]">
              {truncated
                ? `The ${events.length} most recent of ${total} picks.`
                : `${total} ${total === 1 ? 'pick' : 'picks'} so far.`}{' '}
              Most recent:{' '}
              <span className="font-medium text-[color:var(--ink)]">
                {stripTypeLabel(latest.title_romaji || latest.title, latest.event_type)}
              </span>
              , {pickPeriodLabel(latest.event_type, latest.start_at)}.
            </p>

            <div className="space-y-8">
              {groups.map((group) => (
                <section key={group.year} aria-labelledby={`picks-${group.year}`}>
                  <h2 id={`picks-${group.year}`} className="rel-group-title">
                    {group.year}
                  </h2>
                  <ul className="space-y-2">
                    {group.items.map((item) => (
                      <PickHistoryRow key={item.id} item={item} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}

        <div className="mt-10">
          <DiscordCTA
            variant="banner"
            title="Pick the next one"
            description="Nominating and voting happen in the Discord server. Join to have a say in what the club reads next."
          />
        </div>
      </div>
    </div>
  );
}
