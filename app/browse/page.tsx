import { Metadata } from 'next';
import BrowsePageClient from '@/components/browse/BrowsePageClient';
import { browseVNsServer } from '@/lib/vndb-server';
import { generatePageMetadata } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Browse Visual Novels for Learning Japanese',
  description: 'Browse thousands of visual novels from VNDB. Filter by tags, length, release date, and more to find your next Japanese reading challenge.',
  path: '/browse',
});

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const tab = typeof params.tab === 'string' ? params.tab : undefined;

  // Only fetch data server-side for the novels tab (default tab)
  const initialData = (!tab || tab === 'novels')
    ? await browseVNsServer(params)
    : null;

  return (
    <BrowsePageClient
      initialData={initialData}
      initialSearchParams={params}
    />
  );
}
