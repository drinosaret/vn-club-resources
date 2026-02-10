/**
 * Dynamic sitemap generation using Next.js built-in sitemap support.
 *
 * Replaces the old next-sitemap postbuild approach which only picked up
 * statically generated pages. This generates sitemaps for ALL pages including
 * dynamic VN and character pages by querying the backend API.
 *
 * Sitemap index structure:
 *   /sitemap.xml         → sitemap index (manual route — Next.js bug #77304)
 *   /sitemap/0.xml       → static pages + guide pages
 *   /sitemap/1000.xml    → VN pages chunk 0
 *   /sitemap/1001.xml    → VN pages chunk 1
 *   /sitemap/2000.xml    → Character pages chunk 0
 *   /sitemap/2001.xml    → Character pages chunk 1
 */

import type { MetadataRoute } from 'next';
import { getAllContent } from '@/lib/mdx';
import { getBackendUrlOptional } from '@/lib/config';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://vnclub.org';
const URLS_PER_SITEMAP = 50000;

// ID ranges for sitemap chunks — keeps generateSitemaps() and sitemap() in sync
const VN_BASE_ID = 1000;
const CHAR_BASE_ID = 2000;

// Cache sitemap data for 24 hours (VNDB dumps update daily)
export const revalidate = 86400;

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

// ============ Sitemap index ============

export async function generateSitemaps() {
  const sitemaps: Array<{ id: number }> = [{ id: 0 }]; // static pages always included

  // Fetch counts from backend (limit=0 returns just the total)
  const vnData = await fetchSitemapIds('/vn/sitemap-ids', 0, 0);
  const charData = await fetchSitemapIds('/characters/sitemap-ids', 0, 0);

  const vnTotal = vnData?.total ?? 0;
  const charTotal = charData?.total ?? 0;

  const vnChunks = Math.ceil(vnTotal / URLS_PER_SITEMAP);
  const charChunks = Math.ceil(charTotal / URLS_PER_SITEMAP);

  for (let i = 0; i < vnChunks; i++) {
    sitemaps.push({ id: VN_BASE_ID + i });
  }
  for (let i = 0; i < charChunks; i++) {
    sitemaps.push({ id: CHAR_BASE_ID + i });
  }

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

  if (numId >= CHAR_BASE_ID) {
    return generateCharacterSitemap(numId - CHAR_BASE_ID);
  }

  if (numId >= VN_BASE_ID) {
    return generateVNSitemap(numId - VN_BASE_ID);
  }

  return [];
}

// ============ Static pages + guides ============

function generateStaticSitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/guide/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/join/`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/browse/`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/guides/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/stats/`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/stats/global/`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/recommendations/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/news/`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/quiz/`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/tools/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/sources/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/find/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
  ];

  // Add guide pages from MDX content
  try {
    const guides = getAllContent('guides');
    for (const guide of guides) {
      // Skip guides already listed as static pages above
      if (['guide', 'join', 'tools', 'sources', 'find'].includes(guide.slug)) continue;

      staticPages.push({
        url: `${SITE_URL}/${guide.slug}/`,
        lastModified: guide.updated
          ? new Date(guide.updated)
          : guide.date
            ? new Date(guide.date)
            : new Date(),
        changeFrequency: 'monthly',
        priority: 0.7,
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

async function generateCharacterSitemap(chunk: number): Promise<MetadataRoute.Sitemap> {
  const offset = chunk * URLS_PER_SITEMAP;
  const data = await fetchSitemapIds('/characters/sitemap-ids', offset, URLS_PER_SITEMAP);

  if (!data?.items.length) return [];

  return data.items.map((item) => ({
    url: `${SITE_URL}/character/${item.id}/`,
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));
}
