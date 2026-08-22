import type { Metadata } from 'next';
import TrendsClient from './TrendsClient';
import {
  generatePageMetadata,
  safeJsonLdStringify,
  SITE_URL,
  generateBreadcrumbJsonLd,
} from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Visual Novel Trends: What People Are Reading Now',
  description:
    'What the visual novel community is reading right now: trending this week, the biggest jump every month since 2010, the best of every year, and how taste has drifted over three decades.',
  path: '/stats/trends/',
});

const trendsJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Visual Novel Trends: What People Are Reading Now',
  description:
    'Trending visual novels this week and this month, the biggest jump in every month since 2010, the best of each year, and how the community read Japanese visual novels differently over time.',
  url: `${SITE_URL}/stats/trends/`,
  isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
};

const breadcrumbJsonLd = generateBreadcrumbJsonLd([
  { name: 'Home', path: '/' },
  { name: 'Stats', path: '/stats/' },
  { name: 'Trends', path: '/stats/trends/' },
]);

export default function TrendsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdStringify([trendsJsonLd, breadcrumbJsonLd]),
        }}
      />
      <TrendsClient />
    </>
  );
}
