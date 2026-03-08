import { Suspense } from 'react';
import { Metadata } from 'next';
import { BookOpen } from 'lucide-react';
import BeginnerVNsContent from './BeginnerVNsContent';
import {
  generatePageMetadata,
  SITE_URL,
  safeJsonLdStringify,
  generateBreadcrumbJsonLd,
} from '@/lib/metadata-utils';
import { getFeaturedVNsData, type FeaturedVNData } from '@/lib/featured-vns';

export const revalidate = 3600;

export const metadata: Metadata = generatePageMetadata({
  title: 'Beginner Visual Novel Recommendations - Learn Japanese with VNs',
  description:
    'Curated beginner-friendly visual novels for learning Japanese through immersion. Handpicked starter VNs plus easy-difficulty titles to build your reading skills.',
  path: '/beginner-vns/',
});

const breadcrumbJsonLd = generateBreadcrumbJsonLd([
  { name: 'Home', path: '/' },
  { name: 'Beginner VN Recommendations', path: '/beginner-vns/' },
]);

function LoadingFallback() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="max-w-5xl w-full">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 mb-4">
            <BookOpen className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="w-72 h-8 mx-auto rounded image-placeholder mb-3" />
          <div className="w-96 h-5 mx-auto rounded image-placeholder" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg overflow-hidden border border-gray-100 dark:border-gray-700"
            >
              <div className="aspect-3/4 image-placeholder" />
              <div className="p-3 space-y-2">
                <div className="h-4 w-3/4 rounded image-placeholder" />
                <div className="h-3 w-full rounded image-placeholder" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildItemListJsonLd(vns: FeaturedVNData[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Beginner Visual Novel Recommendations',
    description:
      'Curated list of beginner-friendly visual novels for Japanese learners',
    url: `${SITE_URL}/beginner-vns/`,
    numberOfItems: vns.length,
    itemListOrder: 'https://schema.org/ItemListUnordered',
    itemListElement: vns.map((vn, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'VideoGame',
        name: vn.title,
        url: `${SITE_URL}/vn/${vn.id.replace('v', '')}/`,
      },
    })),
    isPartOf: {
      '@type': 'WebSite',
      name: 'VN Club',
      url: SITE_URL,
    },
  };
}

export default async function Page() {
  const featuredVNs = await getFeaturedVNsData();
  const jsonLd = [buildItemListJsonLd(featuredVNs), breadcrumbJsonLd];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdStringify(jsonLd),
        }}
      />
      <Suspense fallback={<LoadingFallback />}>
        <BeginnerVNsContent featuredVNs={featuredVNs} />
      </Suspense>
    </>
  );
}
