/**
 * Dynamic sitemap generation using Next.js built-in sitemap support.
 *
 * Replaces the old next-sitemap postbuild approach which only picked up
 * statically generated pages. This generates sitemaps for ALL pages including
 * dynamic VN, character, and stats entity pages by querying the backend API.
 *
 * Sitemap index structure:
 *   /sitemap.xml         → sitemap index (manual route — Next.js bug #77304)
 *   /sitemap/0.xml       → static pages + guide pages
 *   /sitemap/1000.xml    → VN pages chunk 0
 *   /sitemap/2000.xml    → Character pages chunk 0
 *   /sitemap/3000.xml    → Tag pages chunk 0
 *   /sitemap/4000.xml    → Trait pages chunk 0
 *   /sitemap/5000.xml    → Staff pages chunk 0
 *   /sitemap/6000.xml    → Seiyuu pages chunk 0
 *   /sitemap/7000.xml    → Producer pages chunk 0
 */

import type { MetadataRoute } from 'next';
import { getAllContent } from '@/lib/mdx';
import { getBackendUrlOptional } from '@/lib/config';
import {
  SITE_URL,
  URLS_PER_SITEMAP,
  VN_BASE_ID,
  CHAR_BASE_ID,
  TAG_BASE_ID,
  TRAIT_BASE_ID,
  STAFF_BASE_ID,
  SEIYUU_BASE_ID,
  PRODUCER_BASE_ID,
} from '@/lib/sitemap-config';

// Cache sitemap data for 24 hours (VNDB dumps update daily)
export const revalidate = 86400;

// No BUILD_DATE — static pages omit lastmod so Google doesn't distrust
// the signal when it drifts every revalidation cycle.

// ============ API helpers ============

interface SitemapIdItem {
  id: string;
  updated_at?: string | null;
}

interface SitemapIdsResponse {
  items: SitemapIdItem[];
  total: number;
}

async function fetchSitemapIds(
  path: string,
  offset = 0,
  limit = 1,
): Promise<SitemapIdsResponse | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  try {
    const url = `${backendUrl}/api/v1${path}?offset=${offset}&limit=${limit}`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/** Fetch just the total count (limit=0). */
async function fetchTotal(path: string): Promise<number> {
  const data = await fetchSitemapIds(path, 0, 0);
  return data?.total ?? 0;
}

/** Fetch the last VNDB import date for entity sitemaps. */
async function fetchLastImportDate(): Promise<Date | undefined> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return undefined;

  try {
    const res = await fetch(`${backendUrl}/api/v1/stats/last-import-date`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data?.last_import ? new Date(data.last_import) : undefined;
  } catch {
    return undefined;
  }
}

/** Push chunk IDs for a given base and total. */
function pushChunks(sitemaps: Array<{ id: number }>, baseId: number, total: number) {
  const chunks = Math.ceil(total / URLS_PER_SITEMAP);
  for (let i = 0; i < chunks; i++) {
    sitemaps.push({ id: baseId + i });
  }
}

// ============ Sitemap index ============

export async function generateSitemaps() {
  const sitemaps: Array<{ id: number }> = [{ id: 0 }]; // static pages always included

  // Fetch counts from backend in parallel
  const [vnTotal, charTotal, tagTotal, traitTotal, staffTotal, seiyuuTotal, producerTotal] =
    await Promise.all([
      fetchTotal('/vn/sitemap-ids'),
      fetchTotal('/characters/sitemap-ids'),
      fetchTotal('/stats/tags/sitemap-ids'),
      fetchTotal('/stats/traits/sitemap-ids'),
      fetchTotal('/stats/staff/sitemap-ids'),
      fetchTotal('/stats/seiyuu/sitemap-ids'),
      fetchTotal('/stats/producers/sitemap-ids'),
    ]);

  pushChunks(sitemaps, VN_BASE_ID, vnTotal);
  pushChunks(sitemaps, CHAR_BASE_ID, charTotal);
  pushChunks(sitemaps, TAG_BASE_ID, tagTotal);
  pushChunks(sitemaps, TRAIT_BASE_ID, traitTotal);
  pushChunks(sitemaps, STAFF_BASE_ID, staffTotal);
  pushChunks(sitemaps, SEIYUU_BASE_ID, seiyuuTotal);
  pushChunks(sitemaps, PRODUCER_BASE_ID, producerTotal);

  return sitemaps;
}

// ============ Per-chunk sitemap generation ============

export default async function sitemap(props: {
  id: Promise<number>;
}): Promise<MetadataRoute.Sitemap> {
  // Next.js 16: route params are Promises and must be awaited
  const rawId = await props.id;
  const numId = Number(rawId);

  if (numId === 0 || isNaN(numId)) {
    return generateStaticSitemap();
  }

  // Fetch last import date for entity pages (covers characters through producers)
  const lastImportDate = numId >= CHAR_BASE_ID
    ? await fetchLastImportDate()
    : undefined;

  if (numId >= PRODUCER_BASE_ID) {
    return generateEntitySitemap(numId - PRODUCER_BASE_ID, '/stats/producers/sitemap-ids', '/stats/producer/', 0.5, 'monthly', lastImportDate);
  }
  if (numId >= SEIYUU_BASE_ID) {
    return generateEntitySitemap(numId - SEIYUU_BASE_ID, '/stats/seiyuu/sitemap-ids', '/stats/seiyuu/', 0.5, 'monthly', lastImportDate);
  }
  if (numId >= STAFF_BASE_ID) {
    return generateEntitySitemap(numId - STAFF_BASE_ID, '/stats/staff/sitemap-ids', '/stats/staff/', 0.5, 'monthly', lastImportDate);
  }
  if (numId >= TRAIT_BASE_ID) {
    return generateEntitySitemap(numId - TRAIT_BASE_ID, '/stats/traits/sitemap-ids', '/stats/trait/', 0.4, 'monthly', lastImportDate);
  }
  if (numId >= TAG_BASE_ID) {
    return generateEntitySitemap(numId - TAG_BASE_ID, '/stats/tags/sitemap-ids', '/stats/tag/', 0.5, 'monthly', lastImportDate);
  }
  if (numId >= CHAR_BASE_ID) {
    return generateCharacterSitemap(numId - CHAR_BASE_ID, lastImportDate);
  }
  if (numId >= VN_BASE_ID) {
    return generateVNSitemap(numId - VN_BASE_ID);
  }

  return [];
}

// ============ Static pages + guides ============

function generateStaticSitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${SITE_URL}/guide/`, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${SITE_URL}/join/`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/browse/`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/random/`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/guides/`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/stats/`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/stats/global/`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/stats/compare/`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/recommendations/`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/news/`, changeFrequency: 'daily', priority: 0.6 },
    // News tab pages
    ...['all', 'recently-added', 'releases', 'rss', 'twitter', 'announcements'].map((slug) => ({
      url: `${SITE_URL}/news/${slug}/`,
      changeFrequency: 'daily' as const,
      priority: 0.5,
    })),
    { url: `${SITE_URL}/quiz/`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/tools/`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/sources/`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/find/`, changeFrequency: 'weekly', priority: 0.8 },
  ];

  // Add guide pages from MDX content
  try {
    const guides = getAllContent('guides');
    for (const guide of guides) {
      // Skip guides already listed as static pages above
      if (['guide', 'join', 'tools', 'sources', 'find'].includes(guide.slug)) continue;

      const sitemapMeta = (guide as Record<string, unknown>).sitemap as
        | { priority?: number; changefreq?: string }
        | undefined;

      staticPages.push({
        url: `${SITE_URL}/${guide.slug}/`,
        lastModified: guide.updated
          ? new Date(guide.updated)
          : guide.date
            ? new Date(guide.date)
            : undefined,
        changeFrequency: (sitemapMeta?.changefreq as MetadataRoute.Sitemap[number]['changeFrequency']) || 'monthly',
        priority: sitemapMeta?.priority || 0.7,
      });
    }
  } catch {
    // MDX loading may fail during edge cases — still return static pages
  }

  return staticPages;
}

// ============ VN pages ============

async function generateVNSitemap(chunk: number): Promise<MetadataRoute.Sitemap> {
  const offset = chunk * URLS_PER_SITEMAP;
  const data = await fetchSitemapIds('/vn/sitemap-ids', offset, URLS_PER_SITEMAP);

  if (!data?.items.length) return [];

  return data.items.map((item) => ({
    url: `${SITE_URL}/vn/${item.id}/`,
    lastModified: item.updated_at ? new Date(item.updated_at) : undefined,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));
}

// ============ Character pages ============

async function generateCharacterSitemap(chunk: number, lastImportDate?: Date): Promise<MetadataRoute.Sitemap> {
  const offset = chunk * URLS_PER_SITEMAP;
  const data = await fetchSitemapIds('/characters/sitemap-ids', offset, URLS_PER_SITEMAP);

  if (!data?.items.length) return [];

  return data.items.map((item) => ({
    url: `${SITE_URL}/character/${item.id}/`,
    lastModified: item.updated_at ? new Date(item.updated_at) : lastImportDate,
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));
}

// ============ Stats entity pages (tags, traits, staff, seiyuu, producers) ============

async function generateEntitySitemap(
  chunk: number,
  apiPath: string,
  urlPrefix: string,
  priority: number,
  changeFrequency: 'weekly' | 'monthly',
  lastImportDate?: Date,
): Promise<MetadataRoute.Sitemap> {
  const offset = chunk * URLS_PER_SITEMAP;
  const data = await fetchSitemapIds(apiPath, offset, URLS_PER_SITEMAP);

  if (!data?.items.length) return [];

  return data.items.map((item) => ({
    url: `${SITE_URL}${urlPrefix}${item.id}/`,
    lastModified: lastImportDate,
    changeFrequency,
    priority,
  }));
}
