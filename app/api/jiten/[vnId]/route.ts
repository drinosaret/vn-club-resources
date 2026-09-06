import { NextRequest, NextResponse } from 'next/server';
import { resolveDeckId } from '../resolve-deck';
import { checkRateLimit, getClientIp, createRateLimitHeaders, RATE_LIMITS } from '@/lib/rate-limit';

// Deck ID mappings essentially never change, so cache aggressively
const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=86400';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vnId: string }> }
) {
  const { vnId } = await params;

  // Basic validation: vnId should look like "v" + digits
  if (!/^v\d+$/.test(vnId)) {
    return NextResponse.json(null, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const rateLimitResult = checkRateLimit(`jiten:${getClientIp(request)}`, RATE_LIMITS.externalProxy);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(null, {
      status: 429,
      headers: { ...createRateLimitHeaders(rateLimitResult), 'Cache-Control': 'no-store' },
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    // resolveDeckId has its own 24-hour server-side cache,
    // so this won't spam the upstream jiten.moe API.
    const deckId = await resolveDeckId(vnId, controller.signal);
    const data = deckId ? [deckId] : [];

    return NextResponse.json(data, {
      headers: { 'Cache-Control': CACHE_CONTROL },
    });
  } catch {
    return NextResponse.json(null, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
