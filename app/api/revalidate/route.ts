import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { verifyRefreshToken } from '@/lib/refresh-token';
import { checkRateLimit, getClientIp, createRateLimitHeaders } from '@/lib/rate-limit';

/**
 * POST /api/revalidate
 *
 * Drops this site's cached copy of a tagged fetch. The backend calls it when it has rebuilt
 * something the site holds for a while, so the rebuild reaches readers now rather than when
 * the hold expires. Only tags named here can be dropped; anything else is refused.
 *
 * Requires the shared refresh secret. Rate limited to 5 requests per minute.
 */
const KNOWN_TAGS = new Set(['trend-feed']);

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  const rateLimitResult = checkRateLimit(`revalidate:${clientIp}`, { limit: 5, windowMs: 60000 });
  if (!rateLimitResult.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: createRateLimitHeaders(rateLimitResult) });
  }

  const auth = verifyRefreshToken(request);
  if (auth === 'unconfigured') return NextResponse.json({ error: 'Refresh endpoint not configured' }, { status: 503 });
  if (auth !== 'ok') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let requested: unknown;
  try {
    requested = (await request.json())?.tags;
  } catch {
    requested = null;
  }
  const tags = Array.isArray(requested) ? requested.filter((t): t is string => typeof t === 'string' && KNOWN_TAGS.has(t)) : [];
  if (tags.length === 0) return NextResponse.json({ error: 'No known tag named' }, { status: 400 });

  // 'max' marks the copy stale rather than deleting it, so the next render re-fetches
  // without a reader ever waiting on an empty cache.
  for (const tag of tags) revalidateTag(tag, 'max');
  return NextResponse.json({ revalidated: tags });
}
