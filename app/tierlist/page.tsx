import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LayoutGrid } from 'lucide-react';
import TierListContent from './TierListContent';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: 'Visual Novel Tier List Maker - Rank Your VNs',
    description: 'Create a visual novel tier list from your VNDB ratings. Drag and drop to rank your VNs, customize tier labels and colors, and export as a shareable image.',
    path: '/tierlist/',
  }),
  alternates: {
    canonical: `${SITE_URL}/tierlist/`,
    languages: {
      'en': `${SITE_URL}/tierlist/`,
      'ja': `${SITE_URL}/ja/tierlist/`,
    },
  },
};

const tierListJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Visual Novel Tier List Maker',
    description: 'Create a visual novel tier list from your VNDB ratings. Drag and drop to rank, customize tiers, and export as a shareable image.',
    url: `${SITE_URL}/tierlist/`,
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'Any',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: 'VNDB import, customizable tiers, custom labels and colors, drag and drop ranking, covers and titles display modes, PNG export, social sharing',
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
    { name: 'VN Tier List Maker', path: '/tierlist/' },
  ]),
];

function LoadingFallback() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="max-w-5xl w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-900/30 mb-4">
            <LayoutGrid className="w-10 h-10 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="h-10 w-64 mx-auto mb-3 rounded image-placeholder" />
          <div className="h-6 w-96 mx-auto rounded image-placeholder" />
        </div>
        <div className="relative max-w-lg mx-auto mb-8">
          <div className="w-full h-14 rounded-xl image-placeholder" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-2xl mx-auto">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-5 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
              <div className="w-10 h-10 rounded-lg mb-3 image-placeholder" />
              <div className="w-24 h-5 rounded-sm mb-2 image-placeholder" />
              <div className="w-full h-4 rounded-sm mb-1 image-placeholder" />
              <div className="w-3/4 h-4 rounded-sm image-placeholder" />
            </div>
          ))}
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
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(tierListJsonLd) }}
      />
      <Suspense fallback={<LoadingFallback />}>
        <TierListContent />
      </Suspense>
    </>
  );
}
