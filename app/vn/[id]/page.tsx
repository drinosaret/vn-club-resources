import { Metadata } from 'next';
import { getVNForMetadata } from '@/lib/vndb-server';
import {
  generatePageMetadata,
  generateVNJsonLd,
  getOGImagePath,
  truncateDescription,
  safeJsonLdStringify,
} from '@/lib/metadata-utils';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import VNDetailClient from './VNDetailClient';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const vn = await getVNForMetadata(id);

  if (!vn) {
    // Use default title when VN data isn't available yet (will be updated client-side)
    return {
      title: 'Visual Novel',
      description: 'Visual novel information, ratings, and details on VN Club.',
    };
  }

  // Use safe image or fallback for OG
  const ogImage = getOGImagePath(vn.image_url, vn.image_sexual);

  // Clean description and truncate for meta
  const cleanDescription = vn.description
    ? truncateDescription(vn.description, 200)
    : `${vn.title} - Visual novel information, ratings, and details on VN Club.`;

  return generatePageMetadata({
    title: vn.title,
    description: cleanDescription,
    path: `/vn/${id}`,
    image: ogImage,
    imageAlt: `${vn.title} cover`,
    type: 'article',
    largeImage: true,
  });
}

export default async function VNDetailPage({ params }: PageProps) {
  const { id } = await params;
  const vn = await getVNForMetadata(id);

  // Generate JSON-LD for rich results
  const jsonLd = vn ? generateVNJsonLd(vn) : null;

  // Preload the cover image so it starts fetching during HTML parsing
  const vnId = id.startsWith('v') ? id : `v${id}`;
  const coverPreloadUrl = vn?.image_url
    ? getProxiedImageUrl(vn.image_url, { vnId })
    : null;

  return (
    <>
      {coverPreloadUrl && (
        <link
          rel="preload"
          as="image"
          href={coverPreloadUrl}
          fetchPriority="high"
        />
      )}
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
        />
      )}
      <VNDetailClient vnId={id} initialVN={vn} />
    </>
  );
}
