import { Suspense } from 'react';
import { Metadata } from 'next';
import RecommendationsContent from './RecommendationsContent';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Personalized Visual Novel Recommendations',
  description: 'Visual novel recommendations from your VNDB ratings: ranked lists built on tags, premise, staff, studios, voice actors and readers with similar taste, filtered by length, score and language.',
  path: '/recommendations/',
});

const recommendationsJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'VN Recommendations',
    description: 'Visual novel recommendations from your VNDB ratings, ranked on tags, premise, staff, studios, voice actors, character traits and what readers with similar taste went on to read.',
    url: `${SITE_URL}/recommendations/`,
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    isAccessibleForFree: true,
    featureList: [
      'VNDB list import by username',
      'One ranked list per signal: tags, premise, staff, studios, voice actors and character traits',
      'Titles read by readers whose ratings resemble yours',
      'Per-title evidence naming what matched and the rating the signals expect',
      'Filters for length, score, original language, release year and Japanese difficulty',
      'Adjustable balance between the signals',
      'Discovery control between the closest matches and titles at your own popularity level',
      'Four layouts: detail, list, small covers and cards',
    ],
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
    { name: 'VN Recommendations', path: '/recommendations/' },
  ]),
];

function LoadingFallback() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="max-w-5xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          {/* The skeleton shows the same words as the loaded page but must not be a
              heading: the fallback and the resolved content both sit in the streamed
              HTML, so a second h1 here would leave the document with two. */}
          <div className="sec-title">VN Recommendations</div>
          <p className="sec-sub">Personalized recommendations based on your VNDB ratings</p>
        </div>

        {/* How it works button skeleton */}
        <div className="mb-8 max-w-2xl mx-auto">
          <div className="rc-ghost w-full h-9" />
        </div>

        {/* Search form skeleton */}
        <div className="mb-8">
          <div className="relative max-w-lg mx-auto">
            <div className="rc-ghost w-full h-14" />
          </div>
        </div>

        {/* Feature cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left max-w-2xl mx-auto">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rc-panel p-5">
              <div className="rc-ghost w-24 h-4 mb-2" />
              <div className="rc-ghost w-full h-3 mb-1" />
              <div className="rc-ghost w-3/4 h-3" />
            </div>
          ))}
        </div>

        {/* Note skeleton */}
        <div className="mt-10 flex justify-center">
          <div className="rc-ghost w-64 h-3" />
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(recommendationsJsonLd) }}
      />
      <Suspense fallback={<LoadingFallback />}>
        <RecommendationsContent />
      </Suspense>
    </>
  );
}
