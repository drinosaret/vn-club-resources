import { Metadata } from 'next';
import { getTraitForMetadata } from '@/lib/vndb-server';
import { generatePageMetadata, truncateDescription, safeJsonLdStringify, SITE_URL, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import TraitDetailClient from './TraitDetailClient';

interface PageProps {
  params: Promise<{ traitId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { traitId } = await params;
  const trait = await getTraitForMetadata(traitId);

  if (!trait) {
    return {
      title: 'Trait Stats',
      description: 'Visual novel character trait statistics and analysis on VN Club.',
    };
  }

  const description = trait.description
    ? truncateDescription(trait.description, 200)
    : `${trait.name} — character trait statistics, related characters, and analysis on VN Club.`;

  return generatePageMetadata({
    title: `${trait.name} - Trait Stats`,
    description,
    path: `/stats/trait/${traitId}`,
  });
}

export default async function TraitDetailPage({ params }: PageProps) {
  const { traitId } = await params;
  const trait = await getTraitForMetadata(traitId);

  const jsonLd = trait ? [
    {
      '@context': 'https://schema.org',
      '@type': 'Thing',
      name: trait.name,
      description: trait.description ? truncateDescription(trait.description, 500) : undefined,
      url: `${SITE_URL}/stats/trait/${traitId}/`,
    },
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Stats', path: '/stats/' },
      { name: trait.name, path: `/stats/trait/${traitId}/` },
    ]),
  ] : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
        />
      )}
      <TraitDetailClient params={Promise.resolve({ traitId })} />
    </>
  );
}
