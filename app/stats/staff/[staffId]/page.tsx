import { Metadata } from 'next';
import { getStaffForMetadata } from '@/lib/vndb-server';
import { generatePageMetadata, truncateDescription } from '@/lib/metadata-utils';
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
    path: `/stats/staff/${staffId}`,
  });
}

export default async function StaffDetailPage({ params }: PageProps) {
  return <StaffDetailClient params={params} />;
}
