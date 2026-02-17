import { Metadata } from 'next';
import { getVNForMetadata, getVNCharactersServer, getSimilarVNsServer } from '@/lib/vndb-server';
import {
  generatePageMetadata,
  generateVNJsonLd,
  getOGImagePath,
  truncateDescription,
  safeJsonLdStringify,
  generateBreadcrumbJsonLd,
} from '@/lib/metadata-utils';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import VNDetailClient from './VNDetailClient';

export const revalidate = 3600; // ISR: cache pages for 1 hour

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const vn = await getVNForMetadata(id);

  if (!vn) {
    return {
      title: 'Visual Novel',
      description: 'Visual novel information, ratings, and details on VN Club.',
    };
  }

  const ogImage = getOGImagePath(vn.image_url, vn.image_sexual);
  const cleanDescription = vn.description
    ? truncateDescription(vn.description, 200)
    : `${vn.title} - Visual novel information, ratings, and details on VN Club.`;

  // Prefer romaji title for metadata (matches default user preference)
  const metaTitle = (vn.title_romaji && !/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(vn.title_romaji))
    ? vn.title_romaji
    : vn.title;

  return generatePageMetadata({
    title: metaTitle,
    description: cleanDescription,
    path: `/vn/${id}/`,
    image: ogImage,
    imageAlt: `${vn.title} cover`,
    type: 'article',
    largeImage: false,
  });
}

export default async function VNDetailPage({ params }: PageProps) {
  const { id } = await params;

  // Fetch VN metadata, characters, and similar VNs in parallel
  const [vn, characters, similar] = await Promise.all([
    getVNForMetadata(id),
    getVNCharactersServer(id),
    getSimilarVNsServer(id),
  ]);

  const metaTitle = vn
    ? ((vn.title_romaji && !/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(vn.title_romaji)) ? vn.title_romaji : vn.title)
    : null;
  const jsonLd = vn ? [
    generateVNJsonLd(vn),
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Browse', path: '/browse/' },
      { name: metaTitle || vn.title, path: `/vn/${id}/` },
    ]),
  ] : null;
  const vnId = id.startsWith('v') ? id : `v${id}`;
  const coverPreloadUrl = vn?.image_url
    ? getProxiedImageUrl(vn.image_url, { width: 512, vnId })
    : null;

  return (
    <>
      {coverPreloadUrl && (
        <link rel="preload" as="image" href={coverPreloadUrl} fetchPriority="high" />
      )}
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
        />
      )}
      <VNDetailClient
        vnId={id}
        initialVN={vn}
        initialCharacters={characters}
        initialSimilar={similar}
      />
    </>
  );
}

