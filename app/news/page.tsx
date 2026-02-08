import type { Metadata } from 'next';
import { Newspaper } from 'lucide-react';
import { NewsFeed } from '@/components/news';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Visual Novel News & Releases',
  description: 'Latest visual novel news, new Japanese VN releases, and eroge industry updates. Stay informed about upcoming titles for your Japanese reading list.',
  path: '/news',
});

// JSON-LD for news collection page
const newsJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Visual Novel News',
  description: 'Latest visual novel and eroge news',
  url: `${SITE_URL}/news`,
  isPartOf: {
    '@type': 'WebSite',
    name: 'VN Club',
    url: SITE_URL,
  },
};

export default function NewsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(newsJsonLd) }}
      />
      <div className="min-h-[80vh] px-4 py-12">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-rose-100 dark:bg-rose-900/30 mb-4">
            <Newspaper className="w-10 h-10 text-rose-600 dark:text-rose-400" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-3 flex items-center justify-center gap-3">
            VN News
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400">
              Beta
            </span>
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-xl mx-auto">
            Stay updated with the latest Japanese visual novel and eroge news
          </p>
        </div>

        {/* News Feed */}
        <NewsFeed />
      </div>
    </div>
    </>
  );
}
