// Sitemap index is served at /sitemap.xml via rewrite in next.config.mjs.
// Workaround for Next.js bug #77304 (generateSitemaps doesn't create an index).

import { NextResponse } from 'next/server';
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

async function fetchTotal(path: string): Promise<number> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return 0;

  try {
    const url = `${backendUrl}/api/v1${path}?offset=0&limit=0`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return 0;
    const data = await res.json();
    return data.total ?? 0;
  } catch {
    return 0;
  }
}

function pushChunks(ids: number[], baseId: number, total: number) {
  const chunks = Math.ceil(total / URLS_PER_SITEMAP);
  for (let i = 0; i < chunks; i++) ids.push(baseId + i);
}

export async function GET() {
  const ids: number[] = [0];

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

  pushChunks(ids, VN_BASE_ID, vnTotal);
  pushChunks(ids, CHAR_BASE_ID, charTotal);
  pushChunks(ids, TAG_BASE_ID, tagTotal);
  pushChunks(ids, TRAIT_BASE_ID, traitTotal);
  pushChunks(ids, STAFF_BASE_ID, staffTotal);
  pushChunks(ids, SEIYUU_BASE_ID, seiyuuTotal);
  pushChunks(ids, PRODUCER_BASE_ID, producerTotal);

  // Use the last VNDB import date so lastmod only changes when data actually updates.
  // Google distrusts lastmod values that change on every request.
  let lastmod = new Date().toISOString();
  const backendUrl = getBackendUrlOptional();
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/stats/last-import-date`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data?.last_import) lastmod = new Date(data.last_import).toISOString();
      }
    } catch {
      // Fall through to current date
    }
  }

  const entries = ids
    .map((id) => `  <sitemap>\n    <loc>${SITE_URL}/sitemap-${id}.xml</loc>\n    <lastmod>${lastmod}</lastmod>\n  </sitemap>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=43200',
    },
  });
}
