import { Metadata } from 'next';
import { getCharacterServer } from '@/lib/vndb-server';
import { generatePageMetadata, getOGImagePath, truncateDescription, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import CharacterDetailClient from './CharacterDetailClient';

export const revalidate = 3600; // 1 hour ISR, same as VN pages

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const character = await getCharacterServer(id);

  if (!character) {
    return {
      title: `Character ${id}`,
      description: 'Visual novel character information and details on VN Club.',
      // Nothing was found under this id. The page still renders, because the id may be
      // real and the lookup merely unavailable, but a placeholder describing nothing is
      // not worth indexing and the id space is unbounded.
      robots: { index: false, follow: true },
    };
  }

  const displayName = character.original || character.name;
  const description = character.description
    ? truncateDescription(character.description)
    : `${displayName}: visual novel character details, traits, and appearances on VN Club.`;
  const ogImage = getOGImagePath(character.image_url, character.image_sexual);

  return generatePageMetadata({
    title: displayName,
    description,
    path: `/character/${id}/`,
    image: ogImage,
    imageAlt: `${displayName}`,
    largeImage: false,
  });
}

export default async function CharacterDetailPage({ params }: PageProps) {
  const { id } = await params;
  const character = await getCharacterServer(id);

  const displayName = character ? (character.original || character.name) : null;
  const characterJsonLd = character ? [
    {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: displayName,
      description: character.description
        ? truncateDescription(character.description)
        : `${displayName}: visual novel character.`,
      url: `${SITE_URL}/character/${id}/`,
      ...(character.image_url ? { image: getOGImagePath(character.image_url, character.image_sexual) } : {}),
    },
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Browse', path: '/browse/' },
      { name: displayName!, path: `/character/${id}/` },
    ]),
  ] : null;

  return (
    <>
      {characterJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(characterJsonLd) }}
        />
      )}
      <CharacterDetailClient key={id} params={Promise.resolve({ id })} initialCharacter={character} />
    </>
  );
}
