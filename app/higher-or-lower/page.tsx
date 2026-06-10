import type { Metadata } from 'next';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { DiscordCTA } from '@/components/shared/DiscordCTA';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import HigherLowerGame from '@/components/higher-or-lower/HigherLowerGame';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: 'VN Higher or Lower - Japanese Visual Novel Guessing Game',
    description:
      'A Japanese visual novel guessing game. Compare two VNs by popularity, rating, or release year, guess higher or lower, and build the longest streak you can. A free browser game from VN Club.',
    path: '/higher-or-lower/',
  }),
  alternates: {
    canonical: `${SITE_URL}/higher-or-lower/`,
  },
};

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'VN Higher or Lower',
    description:
      'Guess which visual novel ranks higher by votes, rating, or release year. Build a streak, beat your best, and share your score.',
    url: `${SITE_URL}/higher-or-lower/`,
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    featureList: [
      'Compare visual novels by VNDB vote count, rating, or release year',
      'Endless higher or lower gameplay with a running streak',
      'A separate best streak saved per mode in your browser',
      'Shareable score',
    ],
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    author: {
      '@type': 'Organization',
      name: 'VN Club',
      url: SITE_URL,
    },
    isPartOf: {
      '@type': 'WebSite',
      name: 'VN Club',
      url: SITE_URL,
    },
  },
  generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Higher or Lower', path: '/higher-or-lower/' },
  ]),
];

export default function Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }} />

      <div className="border-b border-gray-100 dark:border-gray-800">
        <div className="mx-auto max-w-3xl px-4 py-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">VN Higher or Lower</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-gray-500 dark:text-gray-400">
            Two Japanese visual novels, one call: which has more votes, the higher rating, or the newer release? Pick a
            mode, guess higher or lower, and build the longest streak you can.
          </p>
        </div>
      </div>

      <HigherLowerGame />

      <section className="mx-auto max-w-2xl px-4 py-12 text-sm text-gray-600 dark:text-gray-400">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">How it works</h2>
        <p className="mb-3">
          You are shown two visual novels. One reveals its value for the current mode. Guess whether the other is Higher
          or Lower, then keep going.
        </p>
        <p className="mb-2">Pick what to compare with the toggle above the board:</p>
        <ul className="mb-3 list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Votes</span>: how many people have rated it on
            VNDB, a stand-in for popularity.
          </li>
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Rating</span>: its VNDB rating out of 10.
          </li>
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Year</span>: its release year, so the call is
            newer or older.
          </li>
        </ul>
        <p className="mb-3">
          Each correct guess extends your streak and a new visual novel slides in. One wrong guess ends the run. Every
          mode keeps its own best streak, saved in your browser so you can try to beat it.
        </p>
        <p className="mb-3">
          Votes and ratings come from VNDB. Games with explicit covers are left out by default; enable them with the
          checkbox and they stay blurred until you reveal them.
        </p>
        <p className="mb-3">
          The visual novel on the left links to its detail page, and both do once your run ends. Links open in a new tab
          so reading up on a title never costs you your streak.
        </p>
      </section>

      <DiscordCTA title="Join our Discord" description="Talk visual novels and play along with the club." className="mt-6" />

      <VNDBAttribution />
    </>
  );
}
