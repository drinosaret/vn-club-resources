import { NextResponse } from 'next/server';
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

export const dynamic = 'force-dynamic';

// A crawler asks for many of these in a row, so a backend that stops answering must not
// hold each one open.
const FETCH_TIMEOUT_MS = 10000;

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
  offset: number,
  limit: number,
): Promise<SitemapIdsResponse | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  try {
    const url = `${backendUrl}/api/v1${path}?offset=${offset}&limit=${limit}`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchLastImportDate(): Promise<string | undefined> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return undefined;

  try {
    const res = await fetch(`${backendUrl}/api/v1/stats/last-import-date`, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data?.last_import ? new Date(data.last_import).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

// ============ XML helpers ============

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface UrlEntry {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

function buildUrlsetXml(entries: UrlEntry[]): string {
  const urls = entries.map((e) => {
    let url = `  <url>\n    <loc>${escapeXml(e.loc)}</loc>`;
    if (e.lastmod) url += `\n    <lastmod>${e.lastmod}</lastmod>`;
    if (e.changefreq) url += `\n    <changefreq>${e.changefreq}</changefreq>`;
    if (e.priority !== undefined) url += `\n    <priority>${e.priority}</priority>`;
    url += '\n  </url>';
    return url;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

function xmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=43200',
    },
  });
}

// ============ Static pages + guides (id=0) ============

/**
 * Board URLs come from the live catalogue rather than a hardcoded list, so adding a
 * leaderboard to the backend registry puts it in the sitemap without a second edit here.
 */
async function fetchLeaderboardSlugs(): Promise<string[]> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return [];

  try {
    const res = await fetch(`${backendUrl}/api/v1/leaderboards`, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.boards ?? []).map((board: { slug: string }) => board.slug);
  } catch {
    return [];
  }
}

async function generateStaticEntries(): Promise<UrlEntry[]> {
  const entries: UrlEntry[] = [
    { loc: `${SITE_URL}/`, changefreq: 'weekly', priority: 1.0 },
    { loc: `${SITE_URL}/guide/`, changefreq: 'weekly', priority: 1.0 },
    { loc: `${SITE_URL}/join/`, changefreq: 'monthly', priority: 0.9 },
    { loc: `${SITE_URL}/browse/`, changefreq: 'daily', priority: 0.8 },
    { loc: `${SITE_URL}/random/`, changefreq: 'monthly', priority: 0.6 },
    // The guide index is the parent every guide page's breadcrumb names, so it sits above
    // the individual guides and below the walkthrough it opens with.
    { loc: `${SITE_URL}/guides/`, changefreq: 'weekly', priority: 0.9 },
    { loc: `${SITE_URL}/stats/`, changefreq: 'daily', priority: 0.8 },
    { loc: `${SITE_URL}/stats/global/`, changefreq: 'daily', priority: 0.8 },
    { loc: `${SITE_URL}/stats/compare/`, changefreq: 'monthly', priority: 0.6 },
    { loc: `${SITE_URL}/stats/rankings/`, changefreq: 'daily', priority: 0.8 },
    { loc: `${SITE_URL}/stats/rankings/build/`, changefreq: 'daily', priority: 0.7 },
    { loc: `${SITE_URL}/stats/trends/`, changefreq: 'weekly', priority: 0.7 },
    { loc: `${SITE_URL}/recommendations/`, changefreq: 'weekly', priority: 0.7 },
    { loc: `${SITE_URL}/tierlist/`, changefreq: 'monthly', priority: 0.7 },
    { loc: `${SITE_URL}/3x3-maker/`, changefreq: 'monthly', priority: 0.7 },
    { loc: `${SITE_URL}/roulette/`, changefreq: 'monthly', priority: 0.6 },
    { loc: `${SITE_URL}/higher-or-lower/`, changefreq: 'monthly', priority: 0.6 },
    { loc: `${SITE_URL}/events/`, changefreq: 'daily', priority: 0.7 },
    { loc: `${SITE_URL}/events/history/`, changefreq: 'weekly', priority: 0.7 },
    { loc: `${SITE_URL}/changelog/`, changefreq: 'weekly', priority: 0.5 },
    { loc: `${SITE_URL}/news/`, changefreq: 'daily', priority: 0.7 },
    ...['headlines', 'reviews', 'releases', 'community', 'creators', 'recently-added', 'trailers'].map((slug) => ({
      loc: `${SITE_URL}/news/${slug}/`,
      changefreq: 'daily',
      priority: 0.5,
    })),
    // The forward-looking half of the news section. It is listed apart from the tabs above
    // because it is not a dated archive, and it outranks them because it is the one news
    // page whose content is worth reading before the day it covers.
    { loc: `${SITE_URL}/news/upcoming/`, changefreq: 'daily', priority: 0.7 },
    { loc: `${SITE_URL}/ja/news/`, changefreq: 'daily', priority: 0.6 },
    ...['headlines', 'reviews', 'releases', 'community', 'creators', 'recently-added', 'trailers', 'upcoming'].map((slug) => ({
      loc: `${SITE_URL}/ja/news/${slug}/`,
      changefreq: 'daily',
      priority: 0.5,
    })),
    { loc: `${SITE_URL}/ja/3x3-maker/`, changefreq: 'monthly', priority: 0.6 },
    { loc: `${SITE_URL}/ja/tierlist/`, changefreq: 'monthly', priority: 0.6 },
    { loc: `${SITE_URL}/ja/roulette/`, changefreq: 'monthly', priority: 0.5 },
    { loc: `${SITE_URL}/beginner-vns/`, changefreq: 'monthly', priority: 0.8 },
    { loc: `${SITE_URL}/quiz/`, changefreq: 'monthly', priority: 0.6 },
    // Selected on read rather than on a schedule, so the page carries a different word
    // every day and is worth recrawling at that rate.
    { loc: `${SITE_URL}/word-of-the-day/`, changefreq: 'daily', priority: 0.7 },
    { loc: `${SITE_URL}/level1/`, changefreq: 'monthly', priority: 0.6 },
    { loc: `${SITE_URL}/tools/`, changefreq: 'weekly', priority: 0.7 },
    { loc: `${SITE_URL}/sources/`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${SITE_URL}/find/`, changefreq: 'weekly', priority: 0.8 },
    // The policy pages are indexable and linked from the footer of every page, so they are
    // crawled either way and belong here for consistency. They sit at the bottom of the
    // priority range because nothing on the site competes for them, and they only change
    // when the policy does.
    { loc: `${SITE_URL}/privacy/`, changefreq: 'yearly', priority: 0.3 },
    { loc: `${SITE_URL}/terms/`, changefreq: 'yearly', priority: 0.3 },
  ];

  try {
    const guides = getAllContent('guides');
    for (const guide of guides) {
      // These slugs are already listed above with their own priority, so the loop skips them
      // rather than emitting a second entry for the same URL.
      if (['guide', 'tools', 'sources', 'find'].includes(guide.slug)) continue;

      const sitemapMeta = (guide as Record<string, unknown>).sitemap as
        | { priority?: number; changefreq?: string }
        | undefined;

      const dateStr = guide.updated || guide.date;

      entries.push({
        loc: `${SITE_URL}/${guide.slug}/`,
        lastmod: dateStr ? new Date(dateStr).toISOString() : undefined,
        changefreq: sitemapMeta?.changefreq || 'monthly',
        priority: sitemapMeta?.priority || 0.7,
      });
    }
  } catch {
    // MDX loading may fail during edge cases; still return static pages
  }

  // Board standings are recomputed from each data import, so the import timestamp is their lastmod.
  const [boardSlugs, boardsLastmod] = await Promise.all([
    fetchLeaderboardSlugs(),
    fetchLastImportDate(),
  ]);

  for (const slug of boardSlugs) {
    entries.push({
      loc: `${SITE_URL}/stats/rankings/${slug}/`,
      lastmod: boardsLastmod,
      changefreq: 'daily',
      priority: 0.6,
    });
  }

  return entries;
}

// ============ Entity sitemaps ============

async function generateEntityEntries(
  chunk: number,
  apiPath: string,
  urlPrefix: string,
  priority: number,
  changefreq: string,
  lastImportDate?: string,
): Promise<UrlEntry[]> {
  const offset = chunk * URLS_PER_SITEMAP;
  const data = await fetchSitemapIds(apiPath, offset, URLS_PER_SITEMAP);
  if (!data?.items.length) return [];

  return data.items.map((item) => ({
    loc: `${SITE_URL}${urlPrefix}${item.id}/`,
    lastmod: item.updated_at ? new Date(item.updated_at).toISOString() : lastImportDate,
    changefreq,
    priority,
  }));
}

// ============ Route handler ============

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await props.params;
  const numId = Number(rawId);

  if (isNaN(numId)) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Static pages (id=0)
  if (numId === 0) {
    return xmlResponse(buildUrlsetXml(await generateStaticEntries()));
  }

  // Entity sitemaps need the last import date
  const lastImportDate = numId >= CHAR_BASE_ID ? await fetchLastImportDate() : undefined;

  let entries: UrlEntry[] = [];

  if (numId >= PRODUCER_BASE_ID) {
    entries = await generateEntityEntries(numId - PRODUCER_BASE_ID, '/stats/producers/sitemap-ids', '/stats/producer/', 0.5, 'monthly', lastImportDate);
  } else if (numId >= SEIYUU_BASE_ID) {
    entries = await generateEntityEntries(numId - SEIYUU_BASE_ID, '/stats/seiyuu/sitemap-ids', '/stats/seiyuu/', 0.5, 'monthly', lastImportDate);
  } else if (numId >= STAFF_BASE_ID) {
    entries = await generateEntityEntries(numId - STAFF_BASE_ID, '/stats/staff/sitemap-ids', '/stats/staff/', 0.5, 'monthly', lastImportDate);
  } else if (numId >= TRAIT_BASE_ID) {
    entries = await generateEntityEntries(numId - TRAIT_BASE_ID, '/stats/traits/sitemap-ids', '/stats/trait/', 0.4, 'monthly', lastImportDate);
  } else if (numId >= TAG_BASE_ID) {
    entries = await generateEntityEntries(numId - TAG_BASE_ID, '/stats/tags/sitemap-ids', '/stats/tag/', 0.5, 'monthly', lastImportDate);
  } else if (numId >= CHAR_BASE_ID) {
    entries = await generateEntityEntries(numId - CHAR_BASE_ID, '/characters/sitemap-ids', '/character/', 0.5, 'monthly', lastImportDate);
  } else if (numId >= VN_BASE_ID) {
    const offset = (numId - VN_BASE_ID) * URLS_PER_SITEMAP;
    const data = await fetchSitemapIds('/vn/sitemap-ids', offset, URLS_PER_SITEMAP);
    if (data?.items.length) {
      entries = data.items.map((item) => ({
        loc: `${SITE_URL}/vn/${item.id}/`,
        lastmod: item.updated_at ? new Date(item.updated_at).toISOString() : undefined,
        changefreq: 'weekly',
        priority: 0.7,
      }));
    }
  }

  return xmlResponse(buildUrlsetXml(entries));
}
