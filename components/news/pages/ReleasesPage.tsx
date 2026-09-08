import { SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { fetchReleasesPage, fetchTicker, newsPath, utcToday } from '@/lib/news';
import { OUT_NOW_DAYS, buildOutNow } from '@/lib/out-now';
import { NewsFrame } from '../NewsFrame';
import { NewsTabs } from '../NewsTabs';
import { ArchiveCalendar } from '../ArchiveCalendar';
import { DoujinShelf } from '../releases/DoujinShelf';
import { OutNow } from '../releases/OutNow';
import { RankingsBoard } from '../releases/RankingsBoard';
import { SaleShelf } from '../releases/SaleShelf';

/**
 * The releases page: what has come out over the out-now window, dated newest first, with
 * the doujin storefronts' new works under it and a shelf of the current sales and the
 * stores' rankings beside it. What came out sits on one side and what the stores are
 * doing on the other.
 * What is still ahead belongs to the schedule page, not here. A shelf panel with nothing to
 * show is left out rather than drawn empty.
 */
export async function ReleasesPage({ locale }: { locale: Locale }) {
  const path = newsPath(locale, '/news/releases/');
  const [page, ticker] = await Promise.all([fetchReleasesPage(), fetchTicker()]);
  const label = ns(locale, 'tab.releases');
  const blurb = ns(locale, 'blurb.releases', { days: OUT_NOW_DAYS });

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${label} | ${ns(locale, 'meta.sectionSuffix')}`,
      description: blurb,
      url: `${SITE_URL}${path}`,
      inLanguage: locale,
      isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
    },
    generateBreadcrumbJsonLd([
      { name: ns(locale, 'crumb.home'), path: locale === 'ja' ? '/ja/' : '/' },
      { name: ns(locale, 'page.title'), path: newsPath(locale, '/news/') },
      { name: label, path },
    ]),
  ];

  const onSale = page?.onSale ?? [];
  const doujin = page?.doujin ?? [];
  const dlsite = page?.dlsite;
  const getchu = page?.getchu;
  const days = buildOutNow({ outNow: page?.outNow ?? [], today: utcToday() });
  const hasRankings = Boolean(
    dlsite?.pro?.length || dlsite?.maniax?.length || getchu?.reserve?.length || getchu?.sales?.length,
  );
  const empty = days.length === 0 && onSale.length === 0 && doujin.length === 0 && !hasRankings;

  return (
    <NewsFrame
      locale={locale}
      path={path}
      ticker={ticker}
      tabs={<NewsTabs active="releases" locale={locale} controls={<ArchiveCalendar section="releases" compact />} />}
      left={null}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <div className="nw-section-head">
        <h1 className="nw-section-title">{label}</h1>
        <p className="nw-section-sub">{blurb}</p>
      </div>
      {empty ? (
        <p className="nw-empty">{ns(locale, 'river.empty')}</p>
      ) : (
        <div className="nw-rel">
          <div className="nw-rel-main">
            <OutNow locale={locale} days={days} />
            <DoujinShelf locale={locale} items={doujin} />
          </div>
          <div className="nw-shelf">
            <SaleShelf locale={locale} items={onSale} />
            <RankingsBoard locale={locale} dlsite={dlsite} getchu={getchu} />
          </div>
        </div>
      )}
    </NewsFrame>
  );
}
