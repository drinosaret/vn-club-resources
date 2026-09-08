import { NextResponse } from 'next/server';
import { getBackendUrlOptional } from '@/lib/config';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://vnclub.org';

interface FeedNewsItem {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  url?: string | null;
  publishedAt: string;
}

// The sections a feed reader wants: what was said and what came out. Catalogue additions
// and trailers stay on the site, where they have covers and stills to go with them.
const SECTIONS: { slug: string; limit: number }[] = [
  { slug: 'headlines', limit: 60 },
  { slug: 'releases', limit: 40 },
];
const FEED_LIMIT = 100;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function section(base: string, slug: string, limit: number): Promise<FeedNewsItem[]> {
  try {
    const res = await fetch(`${base}/api/v1/news/feed?section=${slug}&limit=${limit}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

export async function GET() {
  let items: FeedNewsItem[] = [];

  const base = getBackendUrlOptional();
  if (base) {
    const batches = await Promise.all(SECTIONS.map((s) => section(base, s.slug, s.limit)));
    items = batches
      .flat()
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, FEED_LIMIT);
  }

  const lastBuildDate = items.length > 0
    ? new Date(items[0].publishedAt).toUTCString()
    : new Date().toUTCString();

  const rssItems = items.map((item) => {
    const link = item.url || `${SITE_URL}/news/`;
    const pubDate = new Date(item.publishedAt).toUTCString();
    const description = item.summary
      ? `<description>${escapeXml(item.summary)}</description>`
      : '';

    return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(item.id)}</guid>
      <pubDate>${pubDate}</pubDate>
      ${description}
      <category>${escapeXml(item.source)}</category>
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>VN Club - Visual Novel News</title>
    <link>${SITE_URL}/news/</link>
    <description>Japanese visual novel news: releases, announcements and trade press, gathered daily.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    <image>
      <url>${SITE_URL}/assets/hikaru-icon2.webp</url>
      <title>VN Club</title>
      <link>${SITE_URL}</link>
    </image>
${rssItems}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600',
    },
  });
}
