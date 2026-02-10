/**
 * Manual sitemap index route handler.
 *
 * Next.js has a known bug where `generateSitemaps()` does NOT auto-generate
 * a sitemap index at `/sitemap.xml` (GitHub issue #77304). This route handler
 * fills that gap by generating a proper sitemapindex that references all chunks
 * produced by `app/sitemap.ts`.
 *
 * Served at `/sitemap.xml` via a rewrite in next.config.mjs.
 */

import { NextResponse } from 'next/server';
import { getBackendUrlOptional } from '@/lib/config';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://vnclub.org';
const URLS_PER_SITEMAP = 50000;
const VN_BASE_ID = 1000;
const CHAR_BASE_ID = 2000;

export const revalidate = 86400;

async function fetchTotal(path: string): Promise<number> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return 0;

  try {
    const url = `${backendUrl}/api/v1${path}?offset=0&limit=0`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return 0;
    const data = await res.json();
    return data.total ?? 0;
  } catch {
    return 0;
  }
}

export async function GET() {
  const ids: number[] = [0];

  const vnTotal = await fetchTotal('/vn/sitemap-ids');
  const charTotal = await fetchTotal('/characters/sitemap-ids');

  const vnChunks = Math.ceil(vnTotal / URLS_PER_SITEMAP);
  const charChunks = Math.ceil(charTotal / URLS_PER_SITEMAP);

  for (let i = 0; i < vnChunks; i++) ids.push(VN_BASE_ID + i);
  for (let i = 0; i < charChunks; i++) ids.push(CHAR_BASE_ID + i);

  const entries = ids
    .map((id) => `  <sitemap>\n    <loc>${SITE_URL}/sitemap/${id}.xml</loc>\n  </sitemap>`)
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
