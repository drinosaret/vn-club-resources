import { NextResponse } from 'next/server';
import { verifyRefreshToken } from '@/lib/refresh-token';
import { forceRefreshBlacklist, getBlacklistedIds } from '@/lib/blacklist-cache';
import { checkRateLimit, getClientIp, createRateLimitHeaders } from '@/lib/rate-limit';

let warnedNoSecret = false;

/**
 * POST /api/blacklist/refresh
 *
 * Triggers a cache refresh of the blacklist.
 * Called by the Discord bot after rule changes to ensure immediate effect.
 *
 * Requires BLACKLIST_REFRESH_SECRET header for authentication.
 * Rate limited to 5 requests per minute.
 */
export async function POST(request: Request) {
  // Rate limit: 5 requests per minute
  const clientIp = getClientIp(request);
  const rateLimitResult = checkRateLimit(`blacklist-refresh:${clientIp}`, { limit: 5, windowMs: 60000 });
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: createRateLimitHeaders(rateLimitResult) }
    );
  }

  const auth = verifyRefreshToken(request);
  if (auth === 'unconfigured') {
    if (!warnedNoSecret) {
      console.warn('BLACKLIST_REFRESH_SECRET not configured - refresh endpoint disabled');
      warnedNoSecret = true;
    }
    return NextResponse.json({ error: 'Refresh endpoint not configured' }, { status: 503 });
  }
  if (auth !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await forceRefreshBlacklist();
    const blacklistedIds = await getBlacklistedIds();

    console.log(`Blacklist cache refreshed: ${blacklistedIds.length} VNs blacklisted`);

    return NextResponse.json({
      success: true,
      message: 'Blacklist cache refreshed',
      count: blacklistedIds.length,
    });
  } catch (error) {
    console.error('Failed to refresh blacklist cache:', error);
    return NextResponse.json(
      { error: 'Failed to refresh cache' },
      { status: 500 }
    );
  }
}
