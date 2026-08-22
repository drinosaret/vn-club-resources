import { Metadata } from 'next';
import { getVNForMetadata, getVNCharactersServer, getSimilarVNsServer } from '@/lib/vndb-server';
import {
  generatePageMetadata,
  generateVNJsonLd,
  getOGImagePath,
  buildVNMetaDescription,
  safeJsonLdStringify,
  generateBreadcrumbJsonLd,
  SITE_URL,
} from '@/lib/metadata-utils';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { platformLabel } from '@/lib/platforms';
import { resolveDeckId } from '@/app/api/jiten/resolve-deck';
import VNDetailClient from './VNDetailClient';

export const revalidate = 3600; // ISR: cache pages for 1 hour

interface PageProps {
  params: Promise<{ id: string }>;
}

// Both the bare number and the v-prefixed id route here, so the canonical is built from the
// requested form and every self-reference on the page is built from the canonical.
const canonicalPath = (id: string) => `/vn/${id}/`;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const vn = await getVNForMetadata(id);

  if (!vn) {
    return {
      title: `Visual Novel ${id}`,
      description: 'Visual novel information, ratings, and details on VN Club.',
      robots: { index: false, follow: true },
    };
  }

  const ogImage = getOGImagePath(vn.image_url, vn.image_sexual);
  const cleanDescription = buildVNMetaDescription(vn);

  // Prefer romaji title for metadata (matches default user preference)
  const metaTitle = (vn.title_romaji && !/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(vn.title_romaji))
    ? vn.title_romaji
    : vn.title;

  return generatePageMetadata({
    title: `${metaTitle} (Visual Novel)`,
    description: cleanDescription,
    path: canonicalPath(id),
    image: ogImage,
    imageAlt: `${vn.title} cover`,
    type: 'article',
    largeImage: false,
  });
}

export default async function VNDetailPage({ params }: PageProps) {
  const { id } = await params;

  const vnId = id.startsWith('v') ? id : `v${id}`;

  // Fetch VN metadata, characters, similar VNs, and jiten deck ID in parallel
  const [vn, characters, similar, jitenDeckId] = await Promise.all([
    getVNForMetadata(id),
    getVNCharactersServer(id),
    getSimilarVNsServer(id),
    resolveDeckId(vnId).catch(() => undefined as undefined),
  ]);

  const metaTitle = vn
    ? ((vn.title_romaji && !/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(vn.title_romaji)) ? vn.title_romaji : vn.title)
    : null;
  const vnJsonLd = vn ? generateVNJsonLd(vn) : null;
  const jsonLd = vn && vnJsonLd ? [
    {
      ...vnJsonLd,
      url: `${SITE_URL}${canonicalPath(id)}`,
      // The dump stores platforms as VNDB codes; structured data carries the names.
      gamePlatform: vnJsonLd.gamePlatform.map((code) => platformLabel(code, true)),
    },
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Browse', path: '/browse/' },
      { name: metaTitle || vn.title, path: canonicalPath(id) },
    ]),
  ] : null;
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
        key={id}
        vnId={id}
        initialVN={vn}
        initialCharacters={characters}
        initialSimilar={similar}
        initialJitenDeckId={jitenDeckId}
      />
    </>
  );
}

