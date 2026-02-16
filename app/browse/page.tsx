import { Metadata } from 'next';
import { cookies } from 'next/headers';
import BrowsePageClient from '@/components/browse/BrowsePageClient';
import { browseVNsServer } from '@/lib/vndb-server';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Browse Visual Novels for Learning Japanese',
  description: 'Browse thousands of visual novels from VNDB. Filter by tags, length, release date, and more to find your next Japanese reading challenge.',
  path: '/browse',
});

const browseJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Browse Visual Novels for Learning Japanese',
    description: 'Browse thousands of visual novels from VNDB. Filter by tags, length, release date, and more to find your next Japanese reading challenge.',
    url: `${SITE_URL}/browse/`,
    isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
  },
  generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Browse Visual Novels', path: '/browse/' },
  ]),
];

type GridSize = 'small' | 'medium' | 'large';
const GRID_LIMITS: Record<GridSize, number> = { small: 42, medium: 35, large: 28 };

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const tab = typeof params.tab === 'string' ? params.tab : undefined;

  // Read grid size preference from cookie so SSR fetches the correct item count
  const cookieStore = await cookies();
  const gridCookie = cookieStore.get('browse-grid-size')?.value;
  const gridSize: GridSize = (gridCookie === 'small' || gridCookie === 'medium' || gridCookie === 'large')
    ? gridCookie : 'small';
  const limit = GRID_LIMITS[gridSize];

  // Only fetch data server-side for the novels tab (default tab)
  const initialData = (!tab || tab === 'novels')
    ? await browseVNsServer({ ...params, limit: String(limit) })
    : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(browseJsonLd) }}
      />
      <BrowsePageClient
        initialData={initialData}
        initialSearchParams={params}
        serverGridSize={gridSize}
      />
    </>
  );
}
