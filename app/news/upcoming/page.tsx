import type { Metadata } from 'next';
import { upcomingMetadata } from '@/lib/news-metadata';
import { UpcomingPage } from '@/components/news/pages/UpcomingPage';

export const revalidate = 600;

export const metadata: Metadata = upcomingMetadata('en');

export default function UpcomingRoute() {
  return <UpcomingPage locale="en" />;
}
