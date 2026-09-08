import { SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import {
  fetchFeed,
  fetchFront,
  fetchGetchuRankings,
  fetchRail,
  fetchTicker,
  newsPath,
  utcToday,
  type Lang,
} from '@/lib/news';
import { getUpcomingEvents } from '@/lib/events';
import { getUpcomingReleases, UPCOMING_LIMIT_PREVIEW } from '@/lib/upcoming-releases';
import { getVNOfTheDay } from '@/lib/vn-of-the-day';
import { getWordOfTheDay } from '@/lib/word-of-the-day';
import { NewsFrame } from '../NewsFrame';
import { NewsTabs } from '../NewsTabs';
import { LangToggle } from '../LangToggle';
import { River } from '../River';
import { TodayStrip } from '../rail/TodayStrip';
import { TodayPanel } from '../rail/TodayPanel';
import { ComingUpPanel } from '../rail/ComingUpPanel';
import { RankingsPanel } from '../rail/RankingsPanel';
import { SalePanel } from '../rail/SalePanel';
import { ArchiveCalendar } from '../ArchiveCalendar';
import { ReviewsPanel } from '../rail/ReviewsPanel';
import { BoardsPanel } from '../rail/BoardsPanel';
import { CreatorsPanel } from '../rail/CreatorsPanel';
import { TrailersPanel } from '../rail/TrailersPanel';
import { DailyPicksPanel } from '../rail/DailyPicksPanel';
import { ClubPanel } from '../rail/ClubPanel';

// Matches the route's revalidate window, which must stay a literal in the route file.
export const FRONT_REVALIDATE = 600;

// The first page is longer than a later one: the front page is where a reader scrolls, and
// the rows are the page. Load older keeps to the river's own page size.
const FRONT_PAGE_SIZE = 50;

/** The front page, in either language. */
export async function FrontPage({ locale, lang }: { locale: Locale; lang: Lang | null }) {
  const today = utcToday();
  const path = newsPath(locale, '/news/');
  const [feed, front, rail, ticker, getchu, events, vnOfTheDay, wordOfTheDay, upcoming] = await Promise.all([
    fetchFeed('headlines', undefined, FRONT_PAGE_SIZE, lang),
    fetchFront(),
    fetchRail('front', lang),
    fetchTicker(lang),
    fetchGetchuRankings(),
    getUpcomingEvents(6, FRONT_REVALIDATE),
    getVNOfTheDay(),
    getWordOfTheDay(),
    getUpcomingReleases(UPCOMING_LIMIT_PREVIEW),
  ]);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: ns(locale, 'page.title'),
      description: ns(locale, 'page.description'),
      url: `${SITE_URL}${path}`,
      inLanguage: locale,
      isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
    },
    generateBreadcrumbJsonLd([
      { name: ns(locale, 'crumb.home'), path: locale === 'ja' ? '/ja/' : '/' },
      { name: ns(locale, 'page.title'), path },
    ]),
  ];

  const announcements = front?.announcements ?? [];
  const releasesToday = front?.releasesToday ?? [];
  const releasesTomorrow = front?.releasesTomorrow ?? [];

  // A panel with nothing behind it is left out, since an empty rail would still widen the grid.
  const right: React.ReactNode[] = [];
  const frontReviews = front?.reviews ?? [];
  if (frontReviews.length > 0) right.push(<ReviewsPanel key="reviews" locale={locale} items={frontReviews} />);
  if (rail.boards.length > 0) right.push(<BoardsPanel key="boards" locale={locale} items={rail.boards} />);
  if (rail.creators.length > 0) right.push(<CreatorsPanel key="creators" locale={locale} items={rail.creators} />);
  if (rail.trailers.length > 0) {
    right.push(<TrailersPanel key="trailers" locale={locale} items={rail.trailers} today={today} />);
  }
  if (vnOfTheDay || wordOfTheDay) {
    right.push(<DailyPicksPanel key="picks" locale={locale} vnOfTheDay={vnOfTheDay} wordOfTheDay={wordOfTheDay} />);
  }
  if (events.length > 0) right.push(<ClubPanel key="club" locale={locale} events={events} />);

  return (
    <NewsFrame
      locale={locale}
      path={path}
      lang={lang}
      ticker={ticker}
      mastheadIsHeading
      tabs={
        <NewsTabs
          active="front"
          lang={lang}
          locale={locale}
          controls={
            <>
              <LangToggle path={path} lang={lang} locale={locale} />
              <ArchiveCalendar section="front" compact />
            </>
          }
        />
      }
      left={
        <>
          <TodayStrip today={releasesToday} tomorrow={releasesTomorrow} upcoming={upcoming.items} />
          <TodayPanel locale={locale} today={releasesToday} tomorrow={releasesTomorrow} />
          <ComingUpPanel locale={locale} items={upcoming.items} />
          <RankingsPanel locale={locale} dlsite={front?.dlsiteRanking ?? []} getchu={getchu?.reserve ?? []} />
          <SalePanel locale={locale} items={front?.sale ?? []} />
        </>
      }
      right={right.length > 0 ? <>{right}</> : null}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />

      {announcements.length > 0 && (
        <div className="nw-notice">
          {announcements.map((a) => (
            <p key={a.id}>
              <span className="nameplate mr-2 align-middle">{ns(locale, 'plate.club')}</span>
              {a.url ? <a href={a.url}>{a.title}</a> : a.title}
            </p>
          ))}
        </div>
      )}

      <River
        // Remounted when the language changes: the river keeps loaded rows in state, and
        // a page re-rendered under the same route would otherwise keep the old ones.
        key={`headlines:${lang ?? 'all'}`}
        section="headlines"
        initialItems={feed.items}
        initialCursor={feed.nextCursor}
        newestCursor={feed.newestCursor ?? null}
        today={today}
        lead
        lang={lang}
        modules={{ trailers: rail.trailers, covers: rail.covers, reviews: rail.reviews }}
      />
    </NewsFrame>
  );
}
