import { Metadata } from 'next';
import RandomPageClient from '@/components/random/RandomPageClient';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Random Visual Novel Picker — Discover Your Next VN',
  description: 'Randomly discover visual novels with filters for tags, length, rating, language, and more. Roll for random picks from the VNDB database and find your next read.',
  path: '/random/',
});

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Random Visual Novel Picker',
    description: 'Randomly discover visual novels. Apply filters and roll for random picks.',
    url: `${SITE_URL}/random/`,
    isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
  },
  generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Random Visual Novel', path: '/random/' },
  ]),
];

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <RandomPageClient initialSearchParams={params} />
    </>
  );
}
