import type { Metadata } from 'next';
import { frontMetadata } from '@/lib/news-metadata';
import { parseLang } from '@/lib/news';
import { FrontPage } from '@/components/news/pages/FrontPage';

// The headlines job runs several times a day; a page a fraction of that interval behind is current enough.
// A segment config must be a literal, so the value is not shared with the page body.
export const revalidate = 600;

export const metadata: Metadata = frontMetadata('en');

export default async function NewsFrontRoute({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  return <FrontPage locale="en" lang={parseLang((await searchParams).lang)} />;
}
