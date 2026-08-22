import { Suspense } from 'react';
import type { Metadata } from 'next';

import {
  generatePageMetadata,
  safeJsonLdStringify,
  SITE_URL,
  generateBreadcrumbJsonLd,
} from '@/lib/metadata-utils';

import RankingBuilderClient from './RankingBuilderClient';

export const metadata: Metadata = generatePageMetadata({
  title: 'Build a visual novel ranking',
  description:
    'Rank any slice of the VNDB database. Pick an era, platform, length, tag or Japanese difficulty, then rank the titles or the readers who read them, from daily VNDB data.',
  path: '/stats/rankings/build/',
});

export default function RankingBuilderPage() {
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Build a ranking',
      description:
        'Rankings over any slice of the visual novel database, computed on request from daily VNDB data.',
      url: `${SITE_URL}/stats/rankings/build/`,
    },
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Stats', path: '/stats/' },
      { name: 'Rankings', path: '/stats/rankings/' },
      { name: 'Build a ranking', path: '/stats/rankings/build/' },
    ]),
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      {/* The whole slice is read from the query string, which a static render cannot know. */}
      <Suspense
        fallback={
          <div className="mx-auto max-w-3xl px-4 py-10">
            <div className="image-placeholder mb-6 h-9 w-1/2 rounded-lg" />
            <div className="image-placeholder h-40 rounded-xl" />
          </div>
        }
      >
        <RankingBuilderClient />
      </Suspense>
    </>
  );
}
