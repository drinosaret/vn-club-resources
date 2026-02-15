import type { Metadata } from 'next';
import GlobalStatsClient from './GlobalStatsClient';
import { generatePageMetadata, safeJsonLdStringify, SITE_URL, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Global Visual Novel Statistics',
  description:
    'Explore global visual novel statistics from VNDB — top rated VNs, score distributions, release trends, and reading activity across the community.',
  path: '/stats/global',
});

const globalStatsJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Global Visual Novel Statistics',
  description: 'Explore global visual novel statistics from VNDB — top rated VNs, score distributions, release trends, and more.',
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
