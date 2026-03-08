import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LayoutGrid } from 'lucide-react';
import TierListContent from '@/app/tierlist/TierListContent';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: '\u30a8\u30ed\u30b2 \u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u30e1\u30fc\u30ab\u30fc - エロゲ\u30e9\u30f3\u30ad\u30f3\u30b0\u4f5c\u6210',
    description: 'VNDB\u306e\u8a55\u4fa1\u304b\u3089\u30a8\u30ed\u30b2\u306e\u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u3092\u4f5c\u6210\u3002\u30c9\u30e9\u30c3\u30b0\uff06\u30c9\u30ed\u30c3\u30d7\u3067\u30e9\u30f3\u30ad\u30f3\u30b0\u3001\u30c6\u30a3\u30a2\u30e9\u30d9\u30eb\u3068\u30ab\u30e9\u30fc\u3092\u30ab\u30b9\u30bf\u30de\u30a4\u30ba\u3001\u5171\u6709\u53ef\u80fd\u306a\u753b\u50cf\u3068\u3057\u3066\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3002',
    path: '/ja/tierlist/',
  }),
  alternates: {
    canonical: `${SITE_URL}/ja/tierlist/`,
    languages: {
      'en': `${SITE_URL}/tierlist/`,
      'ja': `${SITE_URL}/ja/tierlist/`,
    },
  },
};

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: '\u30a8\u30ed\u30b2 \u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u30e1\u30fc\u30ab\u30fc',
    description: 'VNDB\u306e\u8a55\u4fa1\u307e\u305f\u306f\u624b\u52d5\u691c\u7d22\u304b\u3089\u30a8\u30ed\u30b2\u306e\u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u3092\u4f5c\u6210\u3002\u30c9\u30e9\u30c3\u30b0\uff06\u30c9\u30ed\u30c3\u30d7\u3067\u30e9\u30f3\u30ad\u30f3\u30b0\u3001\u5171\u6709\u53ef\u80fd\u306a\u753b\u50cf\u3068\u3057\u3066\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3002',
    url: `${SITE_URL}/ja/tierlist/`,
    inLanguage: 'ja',
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'Any',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: 'VNDB\u30a4\u30f3\u30dd\u30fc\u30c8\u3001\u30ab\u30b9\u30bf\u30de\u30a4\u30ba\u53ef\u80fd\u306a\u30c6\u30a3\u30a2\u3001\u30ab\u30b9\u30bf\u30e0\u30e9\u30d9\u30eb\u3068\u30ab\u30e9\u30fc\u3001\u30c9\u30e9\u30c3\u30b0\uff06\u30c9\u30ed\u30c3\u30d7\u30e9\u30f3\u30ad\u30f3\u30b0\u3001\u30ab\u30d0\u30fc\u3068\u30bf\u30a4\u30c8\u30eb\u8868\u793a\u30e2\u30fc\u30c9\u3001PNG\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3001SNS\u5171\u6709',
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
    { name: 'エロゲ \u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u30e1\u30fc\u30ab\u30fc', path: '/ja/tierlist/' },
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
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <Suspense fallback={<LoadingFallback />}>
        <TierListContent />
      </Suspense>
    </>
  );
}
