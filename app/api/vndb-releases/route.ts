import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';

interface VNDBReleaseImage {
  url: string;
  sexual: number;
  violence: number;
  type: string;
}

interface VNDBRelease {
  id: string;
  title: string;
  images: VNDBReleaseImage[];
}

interface CachedResult {
  covers: { id: string; title: string; imageUrl: string; imageSexual: number }[];
  timestamp: number;
}

const cache = new Map<string, CachedResult>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX = 500;
// A stalled upstream would otherwise hold a handler for the fetch default of several minutes.
const UPSTREAM_TIMEOUT_MS = 10000;

// The key space is every VN id, so the map is swept and then capped rather than left to grow
// with whatever asks for a cover.
function cacheSet(vnId: string, covers: CachedResult['covers']) {
  const now = Date.now();
  if (cache.size >= CACHE_MAX * 0.8) {
    for (const [key, entry] of cache) {
      if (now - entry.timestamp > CACHE_TTL_MS) cache.delete(key);
    }
  }
  cache.set(vnId, { covers, timestamp: now });
  if (cache.size > CACHE_MAX) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
}

export async function GET(request: NextRequest) {
  const vnId = request.nextUrl.searchParams.get('vnId');
  if (!vnId || !/^v\d+$/.test(vnId)) {
    return NextResponse.json({ error: 'Invalid vnId' }, { status: 400 });
  }

  // Rate limit
  const ip = getClientIp(request);
  const rl = checkRateLimit(`vndb-releases:${ip}`, RATE_LIMITS.externalProxy);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  // Check cache
  const cached = cache.get(vnId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ covers: cached.covers });
  }

  try {
    const res = await fetch('https://api.vndb.org/kana/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: ['vn', '=', ['id', '=', vnId]],
        fields: 'id, title, images{url, sexual, violence, type}',
        sort: 'released',
        results: 25,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'VNDB API error' }, { status: 502 });
    }

    const data = await res.json() as { results: VNDBRelease[] };

    // Filter for front covers and deduplicate by URL
    const seen = new Set<string>();
    const covers: CachedResult['covers'] = [];
    for (const release of data.results) {
      const frontCovers = release.images.filter(img => img.type === 'pkgfront');
      for (const img of frontCovers) {
        if (seen.has(img.url)) continue;
        seen.add(img.url);

        const imageUrl = getProxiedImageUrl(img.url);
        if (!imageUrl) continue;

        covers.push({
          id: release.id,
          title: release.title,
          imageUrl,
          imageSexual: img.sexual ?? 0,
        });
      }
    }

    // Cache result
    cacheSet(vnId, covers);

    return NextResponse.json({ covers });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch releases' }, { status: 502 });
  }
}
