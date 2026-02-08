import { Metadata } from 'next';
import { getTagForMetadata } from '@/lib/vndb-server';
import { generatePageMetadata, truncateDescription, stripBBCode } from '@/lib/metadata-utils';
import TagDetailClient from './TagDetailClient';

interface PageProps {
  params: Promise<{ tagId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tagId } = await params;
  const tag = await getTagForMetadata(tagId);

  if (!tag) {
    return {
      title: 'Tag Stats',
      description: 'Visual novel tag statistics and analysis on VN Club.',
    };
  }

  const description = tag.description
    ? truncateDescription(tag.description, 200)
    : `${tag.name} — visual novel tag statistics, score distribution, and related VNs on VN Club.`;

  return generatePageMetadata({
    title: `${tag.name} - Tag Stats`,
    description,
    path: `/stats/tag/${tagId}`,
  });
}

export default async function TagDetailPage({ params }: PageProps) {
  return <TagDetailClient params={params} />;
}
