import { NextRequest, NextResponse } from 'next/server';
import { resolveDeckId } from '../../resolve-deck';
import { checkRateLimit, getClientIp, createRateLimitHeaders, RATE_LIMITS } from '@/lib/rate-limit';

// Language stats change rarely — cache aggressively
const CACHE_CONTROL = 'public, max-age=21600, stale-while-revalidate=21600';

// Server-side response cache to avoid amplifying upstream requests.
// Each /all/ call makes 4 upstream requests to jiten.moe but costs 1 rate limit token,
// so we cache results here to prevent repeated upstream calls for the same VN.
const responseCache = new Map<string, { data: unknown; ts: number }>();
const RESPONSE_CACHE_TTL = 6 * 60 * 60 * 1000;  // 6 hours for populated results
const NULL_RESPONSE_TTL = 30 * 60 * 1000;         // 30 minutes for null results
const RESPONSE_CACHE_MAX = 1000;

function isNullResult(data: unknown): boolean {
  const obj = data as Record<string, unknown> | null;
  return !obj || (obj.detail === null && obj.difficulty === null && obj.coverage === null);
}

function cacheSet(key: string, data: unknown) {
  const now = Date.now();
  // Evict expired entries when cache is getting full
  if (responseCache.size >= RESPONSE_CACHE_MAX * 0.8) {
    for (const [k, v] of responseCache) {
      const ttl = isNullResult(v.data) ? NULL_RESPONSE_TTL : RESPONSE_CACHE_TTL;
      if (now - v.ts > ttl) responseCache.delete(k);
    }
  }
  responseCache.set(key, { data, ts: now });
  if (responseCache.size > RESPONSE_CACHE_MAX) {
    const firstKey = responseCache.keys().next().value;
    if (firstKey) responseCache.delete(firstKey);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vnId: string }> }
) {
  const { vnId } = await params;

  if (!/^v\d+$/.test(vnId)) {
    return NextResponse.json(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const rateLimitResult = checkRateLimit(`jiten:${getClientIp(request)}`, RATE_LIMITS.externalProxy);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(null, {
      status: 429,
      headers: { ...createRateLimitHeaders(rateLimitResult), 'Cache-Control': 'no-store' },
    });
  }

  // Check server-side cache first
  const cached = responseCache.get(vnId);
  if (cached) {
    const ttl = isNullResult(cached.data) ? NULL_RESPONSE_TTL : RESPONSE_CACHE_TTL;
    if (Date.now() - cached.ts < ttl) {
      return NextResponse.json(cached.data, {
        headers: { 'Cache-Control': CACHE_CONTROL },
      });
    }
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const deckId = await resolveDeckId(vnId, controller.signal);
    if (!deckId) {
      clearTimeout(timeoutId);
      const data = { detail: null, difficulty: null, coverage: null };
      cacheSet(vnId, data);
      return NextResponse.json(
        data,
        { headers: { 'Cache-Control': CACHE_CONTROL } },
      );
    }

    const [detailRes, difficultyRes, coverageRes] = await Promise.all([
      fetch(`https://api.jiten.moe/api/media-deck/${deckId}/detail`, { signal: controller.signal }),
      fetch(`https://api.jiten.moe/api/media-deck/${deckId}/difficulty`, { signal: controller.signal }),
      fetch(`https://api.jiten.moe/api/media-deck/${deckId}/coverage-curve`, { signal: controller.signal }),
    ]);
    clearTimeout(timeoutId);

    // Unwrap jiten.moe's { data: ... } wrapper for each sub-response,
    // matching what jitenFetcher (json?.data ?? json) does for individual endpoints
    const unwrap = (json: unknown) => {
      const obj = json as Record<string, unknown> | null;
      return obj?.data ?? obj;
    };

    const [detail, difficulty, coverage] = await Promise.all([
      detailRes.ok ? detailRes.json().then(unwrap) : null,
      difficultyRes.ok ? difficultyRes.json().then(unwrap) : null,
      coverageRes.ok ? coverageRes.json().then(unwrap) : null,
    ]);

    const data = { detail, difficulty, coverage };
    cacheSet(vnId, data);

    return NextResponse.json(
      data,
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    );
  } catch {
    return NextResponse.json(
      { detail: null, difficulty: null, coverage: null },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
