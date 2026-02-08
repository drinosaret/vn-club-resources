import { Metadata } from 'next';
import { getTraitForMetadata } from '@/lib/vndb-server';
import { generatePageMetadata, truncateDescription } from '@/lib/metadata-utils';
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
  return <TraitDetailClient params={params} />;
}
