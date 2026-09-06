import { Metadata } from 'next';
import {
  generatePageMetadata,
  SITE_URL,
  safeJsonLdStringify,
  generateBreadcrumbJsonLd,
} from '@/lib/metadata-utils';
import {
  getUpcomingReleases,
  groupUpcomingReleases,
  formatReleaseDate,
  type UpcomingRelease,
} from '@/lib/upcoming-releases';
import { UpcomingReleaseRow } from '@/components/releases/UpcomingReleaseRow';
import { TabNavigation } from '@/components/news/TabNavigation';

// Rendered per request: the listing comes from an endpoint whose availability is not
// guaranteed at build time, and an endpoint that is not there yet reads as an empty list.
export const dynamic = 'force-dynamic';

const PATH = '/news/upcoming/';

export const metadata: Metadata = generatePageMetadata({
  title: 'Upcoming Visual Novel Releases',
  description:
    'Japanese visual novels whose first release is still ahead, grouped by month and listed soonest first. Cover, developer, platforms, and only as much of each date as has actually been announced.',
  path: PATH,
});

const breadcrumbJsonLd = generateBreadcrumbJsonLd([
  { name: 'Home', path: '/' },
  { name: 'Visual Novel News', path: '/news/all/' },
  { name: 'Upcoming Releases', path: PATH },
]);

function buildItemListJsonLd(items: UpcomingRelease[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Upcoming Visual Novel Releases',
    description: 'Visual novels announced with a release date that has not arrived yet.',
    url: `${SITE_URL}${PATH}`,
    numberOfItems: items.length,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'VideoGame',
        name: item.title_romaji || item.title,
        url: `${SITE_URL}/vn/${item.id}/`,
        // Only stated where the dump named a day. A partial date is not a release date
        // as far as a consumer of this is concerned.
        ...(item.date_precision === 'day' ? { datePublished: item.released } : {}),
        // The romanisation where the catalogue has one: this is read by consumers with no
        // reader behind them to hold a script preference.
        ...(item.developers.length > 0
          ? {
              author: {
                '@type': 'Organization',
                name: item.developers[0].original || item.developers[0].name,
              },
            }
          : {}),
      },
    })),
  };
}

export default async function UpcomingReleasesPage() {
  const { items } = await getUpcomingReleases();
  const groups = groupUpcomingReleases(items);

  return (
    // The news layout supplies the outer frame and the page heading, so this renders the
    // tab strip and the list only.
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(breadcrumbJsonLd) }}
      />
      {items.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(buildItemListJsonLd(items)) }}
        />
      )}

      <div className="mb-6">
        <TabNavigation activeTab="upcoming" />
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8">
          <h2 className="sec-title">Upcoming Visual Novel Releases</h2>
          <p className="mt-3 text-sm text-[color:var(--text-secondary)]">
            Japanese visual novels whose first release is still ahead, soonest first. A title
            written in another language that happens to get a Japanese edition is a different
            thing, and is not listed here.
          </p>
          <p className="mt-2 text-sm text-[color:var(--nezu)]">
            Dates come from VNDB and are only as exact as the announcement behind them. A title
            marked <span className="font-mono text-xs">Day TBA</span> has a month but no day yet,
            and one grouped under a bare year has neither.
          </p>
        </header>

        {items.length === 0 ? (
          <p className="panel p-6 text-center text-sm text-[color:var(--nezu)]">
            {/* The panel fill is a pseudo-element painted above the box's own text runs, so the
                sentence is wrapped: only an element child is lifted clear of it. */}
            <span>No announced releases are available right now. Check back shortly.</span>
          </p>
        ) : (
          <>
            <p className="mb-6 font-mono text-xs tracking-wide text-[color:var(--nezu)]">
              {items.length} announced {items.length === 1 ? 'title' : 'titles'}.
            </p>

            <div className="space-y-8">
              {groups.map((group) => (
                <section key={group.key} aria-labelledby={`group-${group.key}`}>
                  <h3 id={`group-${group.key}`} className="rel-group-title">
                    {group.label}
                  </h3>
                  <ul className="space-y-2">
                    {group.items.map((item) => (
                      <UpcomingReleaseRow key={item.id} item={item} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <p className="mt-10 text-xs text-[color:var(--text-faint)]">
              Next up:{' '}
              <span className="font-medium text-[color:var(--nezu)]">
                {items[0].title_romaji || items[0].title}
              </span>
              , {formatReleaseDate(items[0])}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
