import { Metadata } from 'next';
import { getTraitForMetadata } from '@/lib/vndb-server';
import { getBackendUrlOptional } from '@/lib/config';
import { generatePageMetadata, truncateDescription, safeJsonLdStringify, SITE_URL, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import TraitDetailClient from './TraitDetailClient';

interface PageProps {
  params: Promise<{ traitId: string }>;
}

const bareTraitId = (id: string) => id.replace(/^i/, '');

/**
 * Name a trait from the ancestor list of one of the traits below it.
 *
 * A trait at the top of the hierarchy is a grouping level that no character carries
 * directly, so the stats lookup has no rows to build a record from and the name is only
 * reachable from below. An unavailable list comes back empty and leaves it unresolved.
 */
async function getGroupingTraitName(traitId: string): Promise<string | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  const read = async (path: string) => {
    const res = await fetch(`${backendUrl}${path}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(30000),
    });
    return res.ok ? await res.json() : null;
  };

  try {
    const id = encodeURIComponent(traitId);
    const children: { id: string }[] | null = await read(`/api/v1/stats/trait/${id}/children`);
    if (!children?.length) return null;

    const childId = encodeURIComponent(children[0].id);
    const ancestors: { id: string; name: string }[] | null = await read(
      `/api/v1/stats/trait/${childId}/parents`
    );
    const bareId = bareTraitId(traitId);
    return ancestors?.find((a) => bareTraitId(a.id) === bareId)?.name ?? null;
  } catch {
    return null;
  }
}

async function resolveTrait(
  traitId: string
): Promise<{ name: string; description?: string } | null> {
  const trait = await getTraitForMetadata(traitId);
  if (trait) return trait;

  const name = await getGroupingTraitName(traitId);
  return name ? { name } : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { traitId } = await params;
  const trait = await resolveTrait(traitId);

  if (!trait) {
    return {
      title: `Trait ${traitId} Stats`,
      description: 'Visual novel character trait statistics and analysis on VN Club.',
      // Nothing was found under this id. The page still renders, because the id may be
      // real and the lookup merely unavailable, but a placeholder describing nothing is
      // not worth indexing and the id space is unbounded.
      robots: { index: false, follow: true },
    };
  }

  const description = trait.description
    ? truncateDescription(trait.description, 200)
    : `${trait.name}: character trait statistics, related characters, and analysis on VN Club.`;

  return generatePageMetadata({
    title: `${trait.name} - Trait Stats`,
    description,
    path: `/stats/trait/${traitId}/`,
  });
}

export default async function TraitDetailPage({ params }: PageProps) {
  const { traitId } = await params;
  const trait = await resolveTrait(traitId);

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
      <TraitDetailClient key={traitId} params={Promise.resolve({ traitId })} />
    </>
  );
}
