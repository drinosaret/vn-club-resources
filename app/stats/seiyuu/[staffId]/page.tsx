import { Metadata } from 'next';
import { getStaffForMetadata } from '@/lib/vndb-server';
import { generatePageMetadata, truncateDescription } from '@/lib/metadata-utils';
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
    path: `/stats/seiyuu/${staffId}`,
  });
}

export default async function SeiyuuDetailPage({ params }: PageProps) {
  return <SeiyuuDetailClient params={params} />;
}
