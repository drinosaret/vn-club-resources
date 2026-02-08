import { Metadata } from 'next';
import { getProducerForMetadata } from '@/lib/vndb-server';
import { generatePageMetadata } from '@/lib/metadata-utils';
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

  return generatePageMetadata({
    title: `${displayName} - Producer Stats`,
    description: `${displayName} — visual novel producer statistics, score distribution, and catalog on VN Club.`,
    path: `/stats/producer/${producerId}`,
  });
}

export default async function ProducerDetailPage({ params }: PageProps) {
  return <ProducerDetailClient params={params} />;
}
