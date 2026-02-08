import { Metadata } from 'next';
import BrowsePageClient from '@/components/browse/BrowsePageClient';
import { browseVNsServer } from '@/lib/vndb-server';
import { generatePageMetadata } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Browse Visual Novels for Learning Japanese',
  description: 'Browse visual novels from VNDB with filters for difficulty, tags, language, and length. Find the best VN to match your Japanese reading level.',
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
