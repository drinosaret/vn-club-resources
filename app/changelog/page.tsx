import type { Metadata } from 'next';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import ChangelogList from '@/components/changelog/ChangelogList';

export const metadata: Metadata = generatePageMetadata({
  title: 'Changelog',
  description: 'Every major VN Club update in one place: new features on vnclub.org and our Discord bots Hikaru, Muramasa, and Ichijou, all built for learning Japanese with visual novels.',
  path: '/changelog/',
});

const changelogJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'VN Club Changelog',
    description: 'Major user-facing updates across the VN Club site and Discord bots.',
    url: `${SITE_URL}/changelog/`,
    isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
  },
  generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Changelog', path: '/changelog/' },
  ]),
];

export default function ChangelogPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(changelogJsonLd) }}
      />
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">Changelog</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Major updates across VN Club, from the website to our Discord bots, all in one place.
        </p>
        <ChangelogList />
      </div>
    </>
  );
}
