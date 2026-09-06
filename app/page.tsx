import Link from '@/components/Link';
import { Users } from 'lucide-react';
import { TextBox } from '@/components/home/TextBox';
import { TheWeek } from '@/components/home/TheWeek';
import { DailyDigest } from '@/components/home/DailyDigest';
import { Directory } from '@/components/home/Directory';
import { FunFeatures } from '@/components/home/FunFeatures';
import { FeaturedVNs } from '@/components/home/FeaturedVNs';
import { ClubPickCard } from '@/components/home/ClubPickCard';
import { WhatsNewSection } from '@/components/home/WhatsNewSection';
import { getVNOfTheDay } from '@/lib/vn-of-the-day';
import { getWordOfTheDay } from '@/lib/word-of-the-day';
import { getRecentClubPicks } from '@/lib/events';
import { getFeaturedVNsData } from '@/lib/featured-vns';
import { getCommunityPulse } from '@/lib/community-pulse';
import { getHomeNews } from '@/lib/home-news';
import { getHotNow } from '@/lib/hot-now';
import { getUpcomingReleases, UPCOMING_LIMIT_PREVIEW } from '@/lib/upcoming-releases';
import { getSiteDirectorySections } from '@/lib/navigation';
import { safeHomepageCover } from '@/lib/safe-cover';
import type { Metadata } from 'next';
import { safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'VN Club | Japanese Visual Novels, Untranslated',
  alternates: {
    canonical: '/',
  },
  description: 'The hub for people who read Japanese visual novels in the original, untranslated form. What is being read this week, where it ranks, what is coming next, and the club reading it.',
  openGraph: {
    title: 'VN Club | Japanese Visual Novels, Untranslated',
    description: 'For readers of untranslated Japanese visual novels: what is being read now, the rankings, the trends, and the club.',
    url: '/',
    type: 'website',
    images: [
      {
        url: '/assets/hikaru-icon2.webp',
        width: 512,
        height: 512,
        alt: 'VN Club, a site about Japanese visual novels',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'VN Club | Japanese Visual Novels, Untranslated',
    description: 'For readers of untranslated Japanese visual novels: what is being read now, the rankings, the trends, and the club.',
    images: ['/assets/hikaru-icon2.webp'],
  },
};

// WebSite JSON-LD schema with SearchAction
const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'VN Club',
  alternateName: ['Visual Novel Club Resources', 'VNClub'],
  url: 'https://vnclub.org',
  description: 'The hub for people who read Japanese visual novels in the original, untranslated form. What is being read this week, where it ranks, what is coming next, and the club reading it.',
  inLanguage: ['en', 'ja'],
  isAccessibleForFree: true,
  // The medium first, the stance toward it second. The external identifier matters more than
  // the name does: "visual novel" is a loose phrase in English and an exact entity in the
  // knowledge graph, and only the identifier says which one this site is about.
  about: [
    {
      '@type': 'Thing',
      name: 'Japanese visual novels',
      sameAs: [
        'https://en.wikipedia.org/wiki/Visual_novel',
        'https://www.wikidata.org/wiki/Q689445',
      ],
    },
    {
      '@type': 'Thing',
      name: 'Reading Japanese through immersion',
    },
  ],
  audience: {
    '@type': 'Audience',
    audienceType: 'Readers of Japanese visual novels',
  },
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: 'https://vnclub.org/browse/?q={search_term_string}',
    },
    'query-input': 'required name=search_term_string',
  },
};

// Front-page only: surface content tags first in the pick previews. Stable sort
// keeps the existing score order within each group.
function prioritizeContentTags<T extends { category?: string | null }>(tags: T[] | undefined): T[] {
  const rank = (t: T) => ((t.category ?? '').toLowerCase() === 'ero' ? 1 : 0);
  return [...(tags ?? [])].sort((a, b) => rank(a) - rank(b));
}

export default async function Home() {
  // Fetch featured VNs and VN of the Day server-side with ISR caching
  const [featuredVNs, vnOfTheDay, wordOfTheDay, clubPicks, pulse, hot, upcoming, news] =
    await Promise.all([
      getFeaturedVNsData(),
      getVNOfTheDay(),
      getWordOfTheDay(),
      getRecentClubPicks(),
      getCommunityPulse(),
      getHotNow(),
      // The digest lists five dated titles, so the rest of the announced set is not fetched.
      getUpcomingReleases(UPCOMING_LIMIT_PREVIEW),
      getHomeNews(),
    ]);
  const directory = getSiteDirectorySections();

  // Home-page covers are held to a stricter NSFW bar: a cover at/over the threshold
  // is swapped for jiten's SFW cover (or blurred when the VN isn't on jiten).
  const [vnotdCover, monthCover, seasonCover, upcomingCovers] = await Promise.all([
    vnOfTheDay ? safeHomepageCover(vnOfTheDay.vn_id, vnOfTheDay.image_url, vnOfTheDay.image_sexual) : null,
    clubPicks.month ? safeHomepageCover(clubPicks.month.vn.id, clubPicks.month.vn.image_url, clubPicks.month.vn.image_sexual) : null,
    clubPicks.season ? safeHomepageCover(clubPicks.season.vn.id, clubPicks.season.vn.image_url, clubPicks.season.vn.image_sexual) : null,
    // Every announced row, not only the handful the digest currently draws, so which of them
    // the panel picks cannot leave a cover unchecked. A row under the bar costs no lookup.
    Promise.all(
      upcoming.items.map((item) => safeHomepageCover(item.id, item.image_url, item.image_sexual)),
    ),
  ]);
  const vnOfTheDaySafe = vnOfTheDay
    ? {
        ...vnOfTheDay,
        ...(vnotdCover ? { image_url: vnotdCover.imageUrl, image_sexual: vnotdCover.imageSexual } : {}),
        tags: prioritizeContentTags(vnOfTheDay.tags),
      }
    : vnOfTheDay;
  const monthSafe = clubPicks.month
    ? {
        ...clubPicks.month,
        vn: {
          ...clubPicks.month.vn,
          ...(monthCover ? { image_url: monthCover.imageUrl ?? undefined, image_sexual: monthCover.imageSexual } : {}),
          tags: prioritizeContentTags(clubPicks.month.vn.tags),
        },
      }
    : clubPicks.month;
  const seasonSafe = clubPicks.season
    ? {
        ...clubPicks.season,
        vn: {
          ...clubPicks.season.vn,
          ...(seasonCover ? { image_url: seasonCover.imageUrl ?? undefined, image_sexual: seasonCover.imageSexual } : {}),
          tags: prioritizeContentTags(clubPicks.season.vn.tags),
        },
      }
    : clubPicks.season;
  const upcomingSafe = {
    ...upcoming,
    items: upcoming.items.map((item, i) => ({
      ...item,
      image_url: upcomingCovers[i].imageUrl,
      image_sexual: upcomingCovers[i].imageSexual,
    })),
  };

  // A fixed six, in the order the list defines them. The shelf is a set of starting points
  // rather than a sample, so it has no reason to differ between two people looking at it.
  const shelfVNs = featuredVNs.slice(0, 6);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify([
          websiteSchema,
          generateBreadcrumbJsonLd([{ name: 'Home', path: '/' }]),
        ]) }}
      />
      <div className="w-full">
        <TextBox pulse={pulse} fallbackCovers={featuredVNs} advanceTo="club" />

        {/* The band's heading and its label live inside the shelf, so with nothing to shelve
            the whole band goes rather than leaving a tinted strip with no accessible name. */}
        {shelfVNs.length > 0 && (
          <section aria-labelledby="starting-points" className="band band--quiet">
            <div className="container mx-auto px-4 max-w-6xl">
              <FeaturedVNs vns={shelfVNs} />
            </div>
          </section>
        )}

        {/* What the club is reading. Dated, named and public, which is the part of the site no
            catalogue can copy. */}
        <section id="club" aria-labelledby="from-the-club" className="band scroll-mt-20">
          <div className="container mx-auto px-4 max-w-6xl">
            <div className="sec-head">
              <div>
                <h2 id="from-the-club" className="sec-title">
                  From the club
                </h2>
                <p className="sec-sub">
                  A title every month, one a season, and a session every week.
                </p>
              </div>
              <Link href="/events/" className="sec-more">
                Events calendar
                <span aria-hidden>&rarr;</span>
              </Link>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ClubPickCard pick={monthSafe} kind="month" />
              <ClubPickCard pick={seasonSafe} kind="season" />
            </div>
          </div>
        </section>

        <DailyDigest
          hot={hot}
          newReleases={pulse?.newReleases ?? []}
          news={news}
          upcoming={upcomingSafe}
          vnOfTheDay={vnOfTheDaySafe}
          wordOfTheDay={wordOfTheDay}
        />

        {pulse && <TheWeek pulse={pulse} />}

        <FunFeatures fallbackCovers={featuredVNs} pulse={pulse} />

        <Directory directory={directory} />

        <WhatsNewSection />

        {/* 6. Community CTA */}
        <section className="join-band on-box">
          <div className="container mx-auto px-4 max-w-4xl text-center">
            <h2 className="text-2xl md:text-4xl font-bold mb-3 md:mb-4">
              Get Involved
            </h2>
            <p className="text-lg md:text-xl mb-8 md:mb-10 text-[color:var(--nezu)] max-w-2xl mx-auto">
              This is an open wiki maintained by the community. Join us on Discord or help improve
              the site on GitHub.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/join/"
                className="cta-btn"
              >
                <Users className="w-5 h-5" />
                Join Discord
              </Link>
              <a
                href="https://github.com/drinosaret/vn-club-resources"
                target="_blank"
                rel="noopener noreferrer"
                className="cta-btn"
              >
                <GitHubIcon className="w-5 h-5" />
                Contribute on GitHub
              </a>
            </div>
            <blockquote className="mt-8 md:mt-12 text-base md:text-lg italic text-[color:var(--nezu)]">
              &quot;Read more.&quot; – Everyone who made it
            </blockquote>
          </div>
        </section>
      </div>
    </>
  );
}
