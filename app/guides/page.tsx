import { getAllContent } from '@/lib/mdx';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import type { Metadata } from 'next';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Japanese Learning Guides for Visual Novels',
  description: 'Comprehensive guides for setting up text hookers, dictionaries, Anki mining, and other tools for learning Japanese through visual novels. Start reading VNs in Japanese today.',
  path: '/guides/',
});

const guidesJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'VN Club Guides',
    description: 'Comprehensive guides for setting up text hookers, dictionaries, Anki mining, and other tools for learning Japanese through visual novels.',
    url: `${SITE_URL}/guides/`,
    isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
  },
  generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Guides', path: '/guides/' },
  ]),
];

export default async function GuidesPage() {
  const guides = getAllContent('guides');

  return (
    <>
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(guidesJsonLd) }}
    />
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <h1 className="text-4xl font-bold mb-4 text-gray-900 dark:text-white">
        Japanese Learning Guides for Visual Novels
      </h1>
      <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">
        Step-by-step guides for everything you need to start reading visual novels in Japanese. Learn how to set up text hookers, pop-up dictionaries, Anki mining workflows, OCR tools, and more.
      </p>
      <p className="text-base text-gray-500 dark:text-gray-500 mb-10">
        Whether you&apos;re brand new to reading in Japanese or looking to optimize your setup, each guide includes screenshots and detailed instructions to get you up and running quickly.
      </p>

      <div className="space-y-6">
        {guides.map((guide) => (
          <Link
            key={guide.slug}
            href={`/${guide.slug}`}
            className="block bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-xl transition-shadow p-6 group"
          >
            <div className="flex items-start gap-4">
              <div className="mt-1">
                <BookOpen className="w-6 h-6 text-primary-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-white group-hover:text-primary-600 transition-colors">
                  {guide.title}
                </h2>
                {guide.description && (
                  <p className="text-gray-600 dark:text-gray-400">
                    {guide.description}
                  </p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
    </>
  );
}
