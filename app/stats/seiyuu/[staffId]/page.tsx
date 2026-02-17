import { Metadata } from 'next';
import { getStaffForMetadata } from '@/lib/vndb-server';
import { generatePageMetadata, truncateDescription, safeJsonLdStringify, SITE_URL, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import SeiyuuDetailClient from './SeiyuuDetailClient';

interface PageProps {
  params: Promise<{ staffId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { staffId } = await params;
  const staff = await getStaffForMetadata(staffId, 'seiyuu');

  if (!staff) {
    return {
      title: 'Voice Actor Stats',
      description: 'Visual novel voice actor statistics and voiced characters on VN Club.',
    };
  }

  const displayName = staff.original || staff.name;
  const description = staff.description
    ? truncateDescription(staff.description)
    : `${displayName} — voice actor statistics, voiced characters, and career analysis on VN Club.`;

  return generatePageMetadata({
    title: `${displayName} - Voice Actor Stats`,
    description,
    path: `/stats/seiyuu/${staffId}/`,
  });
}

export default async function SeiyuuDetailPage({ params }: PageProps) {
  const { staffId } = await params;
  const staff = await getStaffForMetadata(staffId, 'seiyuu');
  const displayName = staff ? (staff.original || staff.name) : null;

  const jsonLd = displayName ? [
    {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: displayName,
      description: staff!.description ? truncateDescription(staff!.description, 500) : undefined,
      url: `${SITE_URL}/stats/seiyuu/${staffId}/`,
      jobTitle: 'Voice Actor',
    },
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Stats', path: '/stats/' },
      { name: displayName, path: `/stats/seiyuu/${staffId}/` },
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
      <SeiyuuDetailClient params={Promise.resolve({ staffId })} />
    </>
  );
}
