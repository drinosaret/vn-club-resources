import { Metadata } from 'next';
import BrowsePageClient from '@/components/browse/BrowsePageClient';
import { browseVNsServer } from '@/lib/vndb-server';
import { generatePageMetadata } from '@/lib/metadata-utils';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';

export const metadata: Metadata = generatePageMetadata({
  title: 'Browse Visual Novels for Learning Japanese',
  description: 'Browse visual novels from VNDB with filters for difficulty, tags, language, and length. Find the best VN to match your Japanese reading level.',
  path: '/browse',
});

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

// Preload all images on the page — the browser fetches these during HTML parsing,
// before React hydrates, so every cover appears instantly on initial load.
// Matches the default medium grid (35 items = 5 cols × 7 rows).
const PRELOAD_COUNT = 42;

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const tab = typeof params.tab === 'string' ? params.tab : undefined;

  // Only fetch data server-side for the novels tab (default tab)
  const initialData = (!tab || tab === 'novels')
    ? await browseVNsServer(params)
    : null;

  // Generate preload links for the first N cover images.
  // The browser starts fetching these during HTML parsing, before React hydrates,
  // so images appear instantly instead of loading after JS execution.
  const preloadUrls: string[] = [];
  if (initialData?.results) {
    for (let i = 0; i < Math.min(PRELOAD_COUNT, initialData.results.length); i++) {
      const vn = initialData.results[i];
      if (vn.image_url) {
        const vnId = vn.id.startsWith('v') ? vn.id : `v${vn.id}`;
        const url = getProxiedImageUrl(vn.image_url, { width: 512, vnId });
        if (url) preloadUrls.push(url);
      }
    }
  }

  return (
    <>
      {/* Preload above-the-fold cover images for instant display */}
      {preloadUrls.map((url, i) => (
        <link
          key={url}
          rel="preload"
          as="image"
          href={url}
          fetchPriority={i < 15 ? 'high' : 'auto'}
        />
      ))}
      <BrowsePageClient
        initialData={initialData}
        initialSearchParams={params}
      />
    </>
  );
}
