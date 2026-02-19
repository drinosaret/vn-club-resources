import { Suspense } from 'react';
import { Metadata } from 'next';
import RecommendationsContent from './RecommendationsContent';
import { Sparkles } from 'lucide-react';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Personalized Visual Novel Recommendations',
  description: 'Get personalized visual novel recommendations based on your VNDB list. Discover your next VN based on your reading history and preferences.',
  path: '/recommendations/',
});

const recommendationsJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'VN Recommendations',
    description: 'Personalized visual novel recommendations based on your VNDB ratings',
    url: `${SITE_URL}/recommendations/`,
    applicationCategory: 'EducationalApplication',
    isPartOf: {
      '@type': 'WebSite',
      name: 'VN Club',
      url: SITE_URL,
    },
  },
  generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'VN Recommendations', path: '/recommendations/' },
  ]),
];

function LoadingFallback() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-violet-100 dark:bg-violet-900/30 mb-4">
            <Sparkles className="w-10 h-10 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex flex-col items-center gap-2 mb-3">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
              VN Recommendations
            </h1>
            <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
              BETA
            </span>
          </div>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Personalized recommendations based on your VNDB ratings
          </p>
        </div>

        {/* How it works button skeleton */}
        <div className="mb-8 max-w-2xl mx-auto">
          <div className="w-full h-10 rounded-lg image-placeholder" />
        </div>

        {/* Search form skeleton */}
        <div className="mb-8">
          <div className="relative max-w-lg mx-auto">
            <div className="w-full h-14 rounded-xl image-placeholder" />
          </div>
        </div>

        {/* Feature cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left max-w-2xl mx-auto">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-5 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
              <div className="w-10 h-10 rounded-lg mb-3 image-placeholder" />
              <div className="w-24 h-5 rounded mb-2 image-placeholder" />
              <div className="w-full h-4 rounded mb-1 image-placeholder" />
              <div className="w-3/4 h-4 rounded image-placeholder" />
            </div>
          ))}
        </div>

        {/* Note skeleton */}
        <div className="mt-10 text-center">
          <div className="w-64 h-4 rounded mx-auto image-placeholder" />
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
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(recommendationsJsonLd) }}
      />
      <Suspense fallback={<LoadingFallback />}>
        <RecommendationsContent />
      </Suspense>
    </>
  );
}
