import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Grid3X3 } from 'lucide-react';
import GridMakerContent from './GridMakerContent';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: 'Visual Novel 3x3 Maker - Create Your VN Collage',
    description: 'Create a 3x3, 4x4, or 5x5 visual novel collage. Import your VNDB list or search for VNs and characters, crop covers, and export a shareable image.',
    path: '/3x3-maker/',
  }),
  alternates: {
    canonical: `${SITE_URL}/3x3-maker/`,
    languages: {
      'en': `${SITE_URL}/3x3-maker/`,
      'ja': `${SITE_URL}/ja/3x3-maker/`,
    },
  },
};

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Visual Novel 3x3 Maker',
    description: 'Create a 3x3, 4x4, or 5x5 visual novel collage from your VNDB list or manual search. Crop covers and export as a shareable image.',
    url: `${SITE_URL}/3x3-maker/`,
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'Any',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: 'VNDB import, 3x3/4x4/5x5 grid sizes, image cropping, custom titles and scores, PNG export, social sharing',
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
    { name: 'VN 3x3 Maker', path: '/3x3-maker/' },
  ]),
];

function LoadingFallback() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 mb-3">
            <Grid3X3 className="w-8 h-8 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="h-10 w-48 mx-auto mb-3 rounded image-placeholder" />
          <div className="h-5 w-80 mx-auto rounded image-placeholder" />
        </div>
        <div className="max-w-md mx-auto mb-6">
          <div className="w-full h-10 rounded-lg image-placeholder" />
        </div>
        <div className="max-w-[420px] mx-auto grid grid-cols-3 gap-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] rounded-sm image-placeholder" />
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
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <Suspense fallback={<LoadingFallback />}>
        <GridMakerContent />
      </Suspense>
    </>
  );
}
