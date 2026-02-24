import { NextResponse } from 'next/server';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://vnclub.org';
const API_BASE_URL = process.env.NEXT_PUBLIC_NEWS_API_URL || process.env.NEXT_PUBLIC_API_URL || '';

interface FeedNewsItem {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  url?: string | null;
  publishedAt: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  let items: FeedNewsItem[] = [];

  if (API_BASE_URL) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/news?limit=50`, {
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        items = (data.items || []).flatMap((item: FeedNewsItem & { type?: string; items?: FeedNewsItem[] }) => {
          // Flatten digest items into individual entries
          if (item.type === 'digest' && item.items) {
            return item.items.slice(0, 10);
          }
          return [item];
        });
      }
    } catch {
      // API unavailable — return feed with no items
    }
  }

  const lastBuildDate = items.length > 0
    ? new Date(items[0].publishedAt).toUTCString()
    : new Date().toUTCString();

  const rssItems = items.slice(0, 100).map((item) => {
    const link = item.url || `${SITE_URL}/news/all/`;
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
    <link>${SITE_URL}/news/all/</link>
    <description>Japanese visual novel news — new releases, VNDB additions, and community updates for learners reading VNs in Japanese.</description>
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
