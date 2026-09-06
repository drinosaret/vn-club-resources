import { Suspense } from 'react';
import type { Metadata } from 'next';
import {
  generatePageMetadata,
  safeJsonLdStringify,
  SITE_URL,
  generateBreadcrumbJsonLd,
} from '@/lib/metadata-utils';
import CompareContent from './CompareContent';
import { ArrowLeft, Users } from 'lucide-react';

export const metadata: Metadata = generatePageMetadata({
  title: 'Compare Visual Novel Reading Lists',
  description: 'Compare your visual novel reading list with another VNDB user. Find readers with similar taste, see shared VNs, and discover score differences across your libraries.',
  path: '/stats/compare/',
});

// Nothing is listed until two usernames are entered, so this is a tool rather than a
// collection of items.
const compareJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Compare Visual Novel Lists',
  description:
    'Compare two VNDB reading lists side by side: shared visual novels, score differences, and a taste compatibility score, plus a mode that finds readers with the closest lists.',
  url: `${SITE_URL}/stats/compare/`,
  applicationCategory: 'EducationalApplication',
  operatingSystem: 'Any',
  browserRequirements: 'Requires JavaScript',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  featureList: [
    'Two-user reading list comparison',
    'Shared visual novels with per-title score differences',
    'Taste compatibility score',
    'Similar reader lookup from a single username',
  ],
  isPartOf: {
    '@type': 'WebSite',
    name: 'VN Club',
    url: SITE_URL,
  },
};

const breadcrumbJsonLd = generateBreadcrumbJsonLd([
  { name: 'Home', path: '/' },
  { name: 'Stats', path: '/stats/' },
  { name: 'Compare', path: '/stats/compare/' },
]);

function LoadingFallback() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="p-2 rounded-xs">
          <ArrowLeft className="w-5 h-5 text-[color:var(--text-faint)]" />
        </div>
        <div>
          <h1 className="sec-title">Compare Lists</h1>
          <p className="sec-sub">
            See how your VN taste matches with another user
          </p>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="tabs mb-6">
        <span className="tab tab--on">Compare Two Users</span>
        <div className="h-9 w-40 rounded-xs image-placeholder" />
      </div>

      {/* Form skeleton */}
      <div className="st-card p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="w-24 h-5 rounded-xs mb-2 image-placeholder" />
            <div className="w-full h-10 rounded-xs image-placeholder" />
          </div>
          <div>
            <div className="w-24 h-5 rounded-xs mb-2 image-placeholder" />
            <div className="w-full h-10 rounded-xs image-placeholder" />
          </div>
        </div>
        <div className="mt-4 flex justify-center">
          <div className="w-32 h-10 rounded-xs image-placeholder" />
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
        dangerouslySetInnerHTML={{
          __html: safeJsonLdStringify([compareJsonLd, breadcrumbJsonLd]),
        }}
      />
      <Suspense fallback={<LoadingFallback />}>
        <CompareContent />
      </Suspense>
    </>
  );
}
