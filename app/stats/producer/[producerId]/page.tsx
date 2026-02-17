import { Metadata } from 'next';
import { getProducerForMetadata } from '@/lib/vndb-server';
import { generatePageMetadata, truncateDescription, safeJsonLdStringify, SITE_URL, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import ProducerDetailClient from './ProducerDetailClient';

interface PageProps {
  params: Promise<{ producerId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { producerId } = await params;
  const producer = await getProducerForMetadata(producerId);

  if (!producer) {
    return {
      title: 'Producer Stats',
      description: 'Visual novel producer statistics and analysis on VN Club.',
    };
  }

  const displayName = producer.original || producer.name;
  const description = producer.description
    ? truncateDescription(producer.description)
    : `${displayName} — visual novel producer statistics, score distribution, and catalog on VN Club.`;

  return generatePageMetadata({
    title: `${displayName} - Producer Stats`,
    description,
    path: `/stats/producer/${producerId}/`,
  });
}

export default async function ProducerDetailPage({ params }: PageProps) {
  const { producerId } = await params;
  const producer = await getProducerForMetadata(producerId);
  const displayName = producer ? (producer.original || producer.name) : null;

  const jsonLd = displayName ? [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: displayName,
      description: producer!.description ? truncateDescription(producer!.description, 500) : undefined,
      url: `${SITE_URL}/stats/producer/${producerId}/`,
    },
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Stats', path: '/stats/' },
      { name: displayName, path: `/stats/producer/${producerId}/` },
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
      <ProducerDetailClient params={Promise.resolve({ producerId })} />
    </>
  );
}
