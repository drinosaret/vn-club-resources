import { Metadata } from 'next';
import { getTagForMetadata } from '@/lib/vndb-server';
import { generatePageMetadata, truncateDescription, stripBBCode, safeJsonLdStringify, SITE_URL, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import TagDetailClient from './TagDetailClient';

interface PageProps {
  params: Promise<{ tagId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tagId } = await params;
  const tag = await getTagForMetadata(tagId);

  if (!tag) {
    return {
      title: `Tag ${tagId} Stats`,
      description: 'Visual novel tag statistics and analysis on VN Club.',
    };
  }

  const description = tag.description
    ? truncateDescription(tag.description, 200)
    : `${tag.name} — visual novel tag statistics, score distribution, and related VNs on VN Club.`;

  return generatePageMetadata({
    title: `${tag.name} - Tag Stats`,
    description,
    path: `/stats/tag/${tagId}/`,
  });
}

export default async function TagDetailPage({ params }: PageProps) {
  const { tagId } = await params;
  const tag = await getTagForMetadata(tagId);

  const jsonLd = tag ? [
    {
      '@context': 'https://schema.org',
      '@type': 'Thing',
      name: tag.name,
      description: tag.description ? truncateDescription(tag.description, 500) : undefined,
      url: `${SITE_URL}/stats/tag/${tagId}/`,
    },
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Stats', path: '/stats/' },
      { name: tag.name, path: `/stats/tag/${tagId}/` },
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
      <TagDetailClient params={Promise.resolve({ tagId })} />
    </>
  );
}
