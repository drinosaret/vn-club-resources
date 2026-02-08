import { Metadata } from 'next';
import { getCharacterForMetadata } from '@/lib/vndb-server';
import { generatePageMetadata } from '@/lib/metadata-utils';
import CharacterDetailClient from './CharacterDetailClient';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const character = await getCharacterForMetadata(id);

  if (!character) {
    return {
      title: 'Character',
      description: 'Visual novel character information and details on VN Club.',
    };
  }

  const displayName = character.original || character.name;

  return generatePageMetadata({
    title: displayName,
    description: `${displayName} — visual novel character details, traits, and appearances on VN Club.`,
    path: `/character/${id}`,
  });
}

export default async function CharacterDetailPage({ params }: PageProps) {
  return <CharacterDetailClient params={params} />;
}
