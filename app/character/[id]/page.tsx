import { Metadata } from 'next';
import { getCharacterForMetadata } from '@/lib/vndb-server';
import { generatePageMetadata, getOGImagePath, truncateDescription, SITE_URL, safeJsonLdStringify } from '@/lib/metadata-utils';
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
  const description = character.description
    ? truncateDescription(character.description)
    : `${displayName} — visual novel character details, traits, and appearances on VN Club.`;
  const ogImage = getOGImagePath(character.image_url, character.image_sexual);

  return generatePageMetadata({
    title: displayName,
    description,
    path: `/character/${id}`,
    image: ogImage,
    imageAlt: `${displayName}`,
  });
}

export default async function CharacterDetailPage({ params }: PageProps) {
  const { id } = await params;
  const character = await getCharacterForMetadata(id);

  const characterJsonLd = character ? {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: character.original || character.name,
    description: character.description
      ? truncateDescription(character.description)
      : `${character.original || character.name} — visual novel character.`,
    url: `${SITE_URL}/character/${id}/`,
    ...(character.image_url ? { image: getOGImagePath(character.image_url, character.image_sexual) } : {}),
  } : null;

  return (
    <>
      {characterJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(characterJsonLd) }}
        />
      )}
      <CharacterDetailClient params={Promise.resolve({ id })} />
    </>
  );
}
