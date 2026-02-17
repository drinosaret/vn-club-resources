import { Metadata } from 'next';
import { getStaffForMetadata } from '@/lib/vndb-server';
import { generatePageMetadata, truncateDescription, safeJsonLdStringify, SITE_URL, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import StaffDetailClient from './StaffDetailClient';

interface PageProps {
  params: Promise<{ staffId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { staffId } = await params;
  const staff = await getStaffForMetadata(staffId);

  if (!staff) {
    return {
      title: 'Staff Stats',
      description: 'Visual novel staff statistics and credited works on VN Club.',
    };
  }

  const displayName = staff.original || staff.name;
  const description = staff.description
    ? truncateDescription(staff.description)
    : `${displayName} — visual novel staff statistics, credited works, and career analysis on VN Club.`;

  return generatePageMetadata({
    title: `${displayName} - Staff Stats`,
    description,
    path: `/stats/staff/${staffId}/`,
  });
}

export default async function StaffDetailPage({ params }: PageProps) {
  const { staffId } = await params;
  const staff = await getStaffForMetadata(staffId);
  const displayName = staff ? (staff.original || staff.name) : null;

  const jsonLd = displayName ? [
    {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: displayName,
      description: staff!.description ? truncateDescription(staff!.description, 500) : undefined,
      url: `${SITE_URL}/stats/staff/${staffId}/`,
    },
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Stats', path: '/stats/' },
      { name: displayName, path: `/stats/staff/${staffId}/` },
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
      <StaffDetailClient params={Promise.resolve({ staffId })} />
    </>
  );
}
