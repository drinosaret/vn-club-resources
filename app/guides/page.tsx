import { getAllContent } from '@/lib/mdx';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import type { Metadata } from 'next';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Guides',
  description: 'Comprehensive guides for setting up text hookers, dictionaries, Anki mining, and other tools for learning Japanese through visual novels.',
  path: '/guides',
});

const guidesJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'VN Club Guides',
  description: 'Comprehensive guides for setting up text hookers, dictionaries, Anki mining, and other tools for learning Japanese through visual novels.',
  url: `${SITE_URL}/guides/`,
  isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
};

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
        Guides
      </h1>
      <p className="text-lg text-gray-600 dark:text-gray-400 mb-10">
        Comprehensive guides for setting up tools and learning Japanese through visual novels.
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
