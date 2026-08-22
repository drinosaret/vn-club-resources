import type { Metadata } from 'next';
import GlobalStatsClient from './GlobalStatsClient';
import { generatePageMetadata, safeJsonLdStringify, SITE_URL, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Global Visual Novel Statistics',
  description:
    'See the shape of the whole VNDB database at once: the highest rated and most popular visual novels, Japanese-only lists of both, score and release year distributions, and how much of it is rated.',
  path: '/stats/global/',
});

const globalStatsJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Global Visual Novel Statistics',
  description: 'The shape of the whole VNDB database: highest rated and most popular visual novels, score and release year distributions, and rating coverage.',
  url: `${SITE_URL}/stats/global/`,
  isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
};

const breadcrumbJsonLd = generateBreadcrumbJsonLd([
  { name: 'Home', path: '/' },
  { name: 'Stats', path: '/stats/' },
  { name: 'Global Statistics', path: '/stats/global/' },
]);

export default function GlobalStatsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify([globalStatsJsonLd, breadcrumbJsonLd]) }}
      />
      <GlobalStatsClient />
    </>
  );
}
