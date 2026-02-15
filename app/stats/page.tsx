import type { Metadata } from 'next';
import StatsPageClient from './StatsPageClient';
import { generatePageMetadata, safeJsonLdStringify, SITE_URL, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'VNDB Stats — Visual Novel Reading Statistics',
  description:
    'Look up any VNDB user to see their visual novel reading statistics, score distributions, and reading history. Track your Japanese reading progress.',
  path: '/stats',
});

const statsJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'VNDB Stats',
  description: 'Look up any VNDB user to see their visual novel reading statistics, score distributions, and reading history.',
  url: `${SITE_URL}/stats/`,
  isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
};

const breadcrumbJsonLd = generateBreadcrumbJsonLd([
  { name: 'Home', path: '/' },
  { name: 'VNDB Stats', path: '/stats/' },
]);

export default function StatsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify([statsJsonLd, breadcrumbJsonLd]) }}
      />
      <StatsPageClient />
    </>
  );
}
