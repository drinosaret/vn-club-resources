import type { Metadata } from 'next';

import {
  generatePageMetadata,
  safeJsonLdStringify,
  SITE_URL,
  generateBreadcrumbJsonLd,
} from '@/lib/metadata-utils';

import { getLeaderboardCatalogue } from '@/lib/vndb-server';

import RankingsCatalogueClient from './RankingsCatalogueClient';

export const metadata: Metadata = generatePageMetadata({
  title: 'Visual Novel Rankings and Leaderboards',
  description:
    'Community leaderboards built from VNDB data: most read visual novels, most divisive titles, hidden gems, and the readers who have voted on the most obscure corners of the database.',
  path: '/stats/rankings/',
});

const collectionJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Visual Novel Rankings',
  description:
    'Community leaderboards built from VNDB data, covering readers, visual novels, developers and publishers.',
  url: `${SITE_URL}/stats/rankings/`,
  isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
};

const breadcrumbJsonLd = generateBreadcrumbJsonLd([
  { name: 'Home', path: '/' },
  { name: 'Stats', path: '/stats/' },
  { name: 'Rankings', path: '/stats/rankings/' },
]);

export default async function RankingsPage() {
  const catalogue = await getLeaderboardCatalogue();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdStringify([collectionJsonLd, breadcrumbJsonLd]),
        }}
      />
      <RankingsCatalogueClient initialCatalogue={catalogue} />
    </>
  );
}
