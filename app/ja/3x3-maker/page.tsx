import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Grid3X3 } from 'lucide-react';
import GridMakerContent from '@/app/3x3-maker/GridMakerContent';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: '\u30a8\u30ed\u30b2 3x3\u30e1\u30fc\u30ab\u30fc - エロゲ\u30b3\u30e9\u30fc\u30b8\u30e5\u4f5c\u6210',
    description: '3x3\u30014x4\u30015x5\u306e\u30a8\u30ed\u30b2\u30b3\u30e9\u30fc\u30b8\u30e5\u3092\u4f5c\u6210\u3002VNDB\u30ea\u30b9\u30c8\u304b\u3089\u30a4\u30f3\u30dd\u30fc\u30c8\u307e\u305f\u306f\u624b\u52d5\u3067\u691c\u7d22\u3057\u3001\u30ab\u30d0\u30fc\u3092\u30af\u30ed\u30c3\u30d7\u3057\u3066\u5171\u6709\u53ef\u80fd\u306a\u753b\u50cf\u3092\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3002',
    path: '/ja/3x3-maker/',
  }),
  alternates: {
    canonical: `${SITE_URL}/ja/3x3-maker/`,
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
    name: '\u30a8\u30ed\u30b2 3x3\u30e1\u30fc\u30ab\u30fc',
    description: 'VNDB\u30ea\u30b9\u30c8\u307e\u305f\u306f\u624b\u52d5\u691c\u7d22\u304b\u30893x3\u30014x4\u30015x5\u306e\u30a8\u30ed\u30b2\u30b3\u30e9\u30fc\u30b8\u30e5\u3092\u4f5c\u6210\u3002\u30ab\u30d0\u30fc\u3092\u30af\u30ed\u30c3\u30d7\u3057\u3066\u5171\u6709\u53ef\u80fd\u306a\u753b\u50cf\u3092\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3002',
    url: `${SITE_URL}/ja/3x3-maker/`,
    inLanguage: 'ja',
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'Any',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: 'VNDB\u30a4\u30f3\u30dd\u30fc\u30c8\u30013x3/4x4/5x5\u30b0\u30ea\u30c3\u30c9\u30b5\u30a4\u30ba\u3001\u753b\u50cf\u30af\u30ed\u30c3\u30d7\u3001\u30ab\u30b9\u30bf\u30e0\u30bf\u30a4\u30c8\u30eb\u3068\u30b9\u30b3\u30a2\u3001PNG\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3001SNS\u5171\u6709',
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
    { name: '\u30db\u30fc\u30e0', path: '/' },
    { name: 'エロゲ 3x3\u30e1\u30fc\u30ab\u30fc', path: '/ja/3x3-maker/' },
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
