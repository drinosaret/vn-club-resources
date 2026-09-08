import { SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { fetchRail, fetchReleasesPage, fetchTicker, newsPath, utcToday } from '@/lib/news';
import {
  getUpcomingReleases,
  groupUpcomingReleases,
  mergeStoreListings,
  formatReleaseDate,
  type UpcomingRelease,
} from '@/lib/upcoming-releases';
import { UpcomingReleaseRow } from '@/components/releases/UpcomingReleaseRow';
import { NewsFrame } from '../NewsFrame';
import { NewsTabs } from '../NewsTabs';
import { ElsewherePanel } from '../rail/ElsewherePanel';
import { ArchiveCalendar } from '../ArchiveCalendar';

function buildItemListJsonLd(items: UpcomingRelease[], path: string, locale: Locale) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: ns(locale, 'meta.upcoming.title'),
    description: ns(locale, 'meta.upcoming.description'),
    url: `${SITE_URL}${path}`,
    inLanguage: locale,
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

/**
 * The schedule of announced titles, in either language: the catalogue's own entries with
 * the storefront listings folded in, so a title on pre-order says where and for how much.
 */
export async function UpcomingPage({ locale }: { locale: Locale }) {
  const path = newsPath(locale, '/news/upcoming/');
  const [{ items }, releases, rail, ticker] = await Promise.all([
    getUpcomingReleases(),
    fetchReleasesPage(),
    fetchRail('upcoming'),
    fetchTicker(),
  ]);
  const merged = mergeStoreListings(items, releases?.comingUp ?? [], utcToday());
  const groups = groupUpcomingReleases(merged, locale);
  const storeCount = merged.length - items.length;
  const breadcrumb = generateBreadcrumbJsonLd([
    { name: ns(locale, 'crumb.home'), path: locale === 'ja' ? '/ja/' : '/' },
    { name: ns(locale, 'page.title'), path: newsPath(locale, '/news/') },
    { name: ns(locale, 'upcoming.title'), path },
  ]);

  return (
    <NewsFrame
      locale={locale}
      path={path}
      ticker={ticker}
      tabs={<NewsTabs active="upcoming" locale={locale} controls={<ArchiveCalendar section="front" compact />} />}
      left={<ElsewherePanel locale={locale} sections={rail.elsewhere} />}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(breadcrumb) }}
      />
      {items.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(buildItemListJsonLd(items, path, locale)) }}
        />
      )}

      <div className="w-full max-w-3xl">
        <header className="mb-8">
          <h1 className="sec-title">{ns(locale, 'upcoming.title')}</h1>
          <p className="mt-3 text-sm text-[color:var(--text-secondary)]">{ns(locale, 'upcoming.intro')}</p>
          <p className="mt-2 text-sm text-[color:var(--nezu)]">
            {ns(locale, 'upcoming.dates', { tba: '{tba}' })
              .split('{tba}')
              .map((part, i, arr) => (
                <span key={i}>
                  {part}
                  {i < arr.length - 1 && (
                    <span className="font-mono text-xs">{ns(locale, 'upcoming.tba')}</span>
                  )}
                </span>
              ))}
          </p>
        </header>

        {merged.length === 0 ? (
          <p className="panel p-6 text-center text-sm text-[color:var(--nezu)]">
            {/* The panel fill is a pseudo-element painted above the box's own text runs, so the
                sentence is wrapped: only an element child is lifted clear of it. */}
            <span>{ns(locale, 'upcoming.empty')}</span>
          </p>
        ) : (
          <>
            <p className="mb-6 font-mono text-xs tracking-wide text-[color:var(--nezu)]">
              {items.length > 0 &&
                (items.length === 1
                  ? ns(locale, 'upcoming.countOne')
                  : ns(locale, 'upcoming.count', { n: items.length }))}
              {storeCount > 0 && (
                <>
                  {' '}
                  <span className="text-[color:var(--text-faint)]">
                    {ns(locale, 'upcoming.storeCount', { n: storeCount })}
                  </span>
                </>
              )}
            </p>

            <div className="space-y-8">
              {groups.map((group) => (
                <section key={group.key} aria-labelledby={`group-${group.key}`}>
                  <h3 id={`group-${group.key}`} className="rel-group-title">
                    {group.label}
                  </h3>
                  <ul className="space-y-2">
                    {group.items.map((item) => (
                      <UpcomingReleaseRow key={item.id} item={item} locale={locale} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            {items.length > 0 && (
              <p className="mt-10 text-xs text-[color:var(--text-faint)]">
                {ns(locale, 'upcoming.next')}{' '}
                <span className="font-medium text-[color:var(--nezu)]">
                  {items[0].title_romaji || items[0].title}
                </span>
                , {formatReleaseDate(items[0], locale)}.
              </p>
            )}
          </>
        )}
      </div>
    </NewsFrame>
  );
}
