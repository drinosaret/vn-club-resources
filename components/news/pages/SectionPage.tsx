import { notFound, permanentRedirect } from 'next/navigation';
import { SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import type { Locale } from '@/lib/i18n/types';
import { OUT_NOW_DAYS } from '@/lib/out-now';
import { ns } from '@/lib/i18n/translations/news';
import {
  ALL_SLUG,
  LANG_TOGGLE_SECTIONS,
  LEGACY_SLUGS,
  fetchFeed,
  fetchFront,
  fetchRail,
  fetchTicker,
  newsPath,
  sectionBySlug,
  utcToday,
  type FrontBundle,
  type Lang,
  type RailBundle,
} from '@/lib/news';
import { getHotNow, type HotFeed } from '@/lib/hot-now';
import { getUpcomingReleases, UPCOMING_LIMIT_PREVIEW, type UpcomingRelease } from '@/lib/upcoming-releases';
import { NewsFrame } from '../NewsFrame';
import { NewsTabs } from '../NewsTabs';
import { LangToggle } from '../LangToggle';
import { River } from '../River';
import { ReleasesPage } from './ReleasesPage';
import { ElsewherePanel } from '../rail/ElsewherePanel';
import { ArchiveCalendar } from '../ArchiveCalendar';
import { TodayStrip } from '../rail/TodayStrip';
import { TodayPanel } from '../rail/TodayPanel';
import { ComingUpPanel } from '../rail/ComingUpPanel';
import { TrailersPanel } from '../rail/TrailersPanel';
import { ReviewsPanel } from '../rail/ReviewsPanel';
import { BoardsPanel } from '../rail/BoardsPanel';
import { CreatorsPanel } from '../rail/CreatorsPanel';
import { MostReviewedPanel } from '../rail/MostReviewedPanel';
import { ReviewersPanel } from '../rail/ReviewersPanel';
import { HotNowPanel } from '../rail/HotNowPanel';

/** Where an old or aliased slug goes; null when the slug is a section of its own. */
export function sectionRedirect(locale: Locale, slug: string): string | null {
  if (slug === ALL_SLUG) return newsPath(locale, '/news/');
  const target = LEGACY_SLUGS[slug];
  if (!target) return null;
  return newsPath(locale, target === 'front' ? '/news/' : `/news/${target}/`);
}

/**
 * The people rail of a section: the panels beside its stream that have something to show.
 * A panel with nothing behind it is left out, since an empty rail would still widen the grid.
 */
function sectionRail({
  slug,
  locale,
  today,
  front,
  rail,
  upcoming,
  hot,
}: {
  slug: string;
  locale: Locale;
  today: string;
  front: FrontBundle | null;
  rail: RailBundle;
  upcoming: UpcomingRelease[];
  hot: HotFeed | null;
}): React.ReactNode[] {
  const panels: React.ReactNode[] = [];
  const releasesToday = front?.releasesToday ?? [];
  const releasesTomorrow = front?.releasesTomorrow ?? [];

  const outNow = () => {
    if (releasesToday.length === 0 && releasesTomorrow.length === 0) return;
    panels.push(<TodayPanel key="today" locale={locale} today={releasesToday} tomorrow={releasesTomorrow} />);
  };
  const comingUp = () => {
    // The panel draws only the dated ones, so an undated backlog is not something to show.
    if (!upcoming.some((u) => u.date_precision === 'day')) return;
    panels.push(<ComingUpPanel key="coming" locale={locale} items={upcoming} />);
  };
  const trailers = () => {
    if (rail.trailers.length === 0) return;
    panels.push(<TrailersPanel key="trailers" locale={locale} items={rail.trailers} today={today} />);
  };
  const reviews = () => {
    if (rail.reviews.length === 0) return;
    panels.push(<ReviewsPanel key="reviews" locale={locale} items={rail.reviews} />);
  };

  switch (slug) {
    case 'headlines':
      outNow();
      comingUp();
      trailers();
      break;
    case 'reviews':
      if (rail.mostReviewed.length > 0) {
        panels.push(<MostReviewedPanel key="most-reviewed" locale={locale} items={rail.mostReviewed} />);
      }
      if (rail.reviewers.length > 0) {
        panels.push(<ReviewersPanel key="reviewers" locale={locale} items={rail.reviewers} />);
      }
      break;
    case 'community':
      if (rail.boards.length > 0) panels.push(<BoardsPanel key="boards" locale={locale} items={rail.boards} />);
      if (rail.creators.length > 0) panels.push(<CreatorsPanel key="creators" locale={locale} items={rail.creators} />);
      break;
    case 'creators':
      trailers();
      reviews();
      break;
    case 'recently-added':
      if ((hot?.week?.movers?.length ?? 0) > 0) {
        panels.push(<HotNowPanel key="hot" locale={locale} movers={hot?.week?.movers ?? []} />);
      }
      comingUp();
      break;
    case 'trailers':
      outNow();
      comingUp();
      break;
  }
  return panels;
}

/** A section's feed, in either language. */
export async function SectionPage({ locale, slug, lang }: { locale: Locale; slug: string; lang: Lang | null }) {
  const target = sectionRedirect(locale, slug);
  if (target) permanentRedirect(target);
  const section = sectionBySlug(slug);
  if (!section) notFound();
  if (slug === 'releases') return <ReleasesPage locale={locale} />;

  const today = utcToday();
  const path = newsPath(locale, `/news/${slug}/`);
  const label = ns(locale, `tab.${slug}` as 'tab.headlines');
  const blurb = ns(locale, `blurb.${slug}` as 'blurb.headlines', { days: OUT_NOW_DAYS });
  const [feed, rail, ticker, front, upcoming, hot] = await Promise.all([
    fetchFeed(slug, undefined, 30, lang),
    fetchRail(slug, lang),
    fetchTicker(lang),
    fetchFront(),
    getUpcomingReleases(UPCOMING_LIMIT_PREVIEW),
    slug === 'recently-added' ? getHotNow('ja') : Promise.resolve(null),
  ]);

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

  const withToggle = (LANG_TOGGLE_SECTIONS as readonly string[]).includes(slug);
  // The strip stands in for the Out now panel where the rail is folded away, so it belongs
  // only to the sections whose rail carries that panel.
  const withStrip = slug === 'headlines' || slug === 'trailers';
  const right = sectionRail({ slug, locale, today, front, rail, upcoming: upcoming.items, hot });

  return (
    <NewsFrame
      locale={locale}
      path={path}
      lang={lang}
      ticker={ticker}
      tabs={
        <NewsTabs
          active={slug}
          lang={lang}
          locale={locale}
          controls={
            <>
              {withToggle && <LangToggle path={path} lang={lang} locale={locale} />}
              <ArchiveCalendar section={slug} compact />
            </>
          }
        />
      }
      left={
        <>
          {withStrip && (
            <TodayStrip
              today={front?.releasesToday ?? []}
              tomorrow={front?.releasesTomorrow ?? []}
              upcoming={upcoming.items}
            />
          )}
          <ElsewherePanel locale={locale} sections={rail.elsewhere} />
        </>
      }
      right={right.length > 0 ? <>{right}</> : null}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <div className="nw-section-head">
        <h1 className="nw-section-title">{label}</h1>
        <p className="nw-section-sub">{blurb}</p>
      </div>
      <River
        key={`${slug}:${lang ?? 'all'}`}
        section={slug}
        initialItems={feed.items}
        initialCursor={feed.nextCursor}
        newestCursor={feed.newestCursor ?? null}
        today={today}
        lang={lang}
        modules={{ trailers: rail.trailers, covers: rail.covers, reviews: rail.reviews }}
      />
    </NewsFrame>
  );
}
