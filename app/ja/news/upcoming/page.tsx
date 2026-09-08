import type { Metadata } from 'next';
import { upcomingMetadata } from '@/lib/news-metadata';
import { UpcomingPage } from '@/components/news/pages/UpcomingPage';

export const revalidate = 600;

export const metadata: Metadata = upcomingMetadata('ja');

export default function UpcomingRouteJa() {
  return <UpcomingPage locale="ja" />;
}
