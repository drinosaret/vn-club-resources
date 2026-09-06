import type { Metadata } from 'next';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import ChangelogList from '@/components/changelog/ChangelogList';

export const metadata: Metadata = generatePageMetadata({
  title: 'Changelog',
  description: 'Every notable change to VN Club in one place: what is new on the site for readers of Japanese visual novels, and what has changed in the Discord bots Hikaru, Muramasa and Ichijou.',
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
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <h1 className="sec-title">Changelog</h1>
        <p className="sec-sub mb-8">
          Notable changes across VN Club, from the site to the Discord bots, all in one place.
        </p>
        <ChangelogList />
      </div>
    </>
  );
}
