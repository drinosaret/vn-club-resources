import { NextRequest, NextResponse } from 'next/server';
import { resolveDeckId } from '../../resolve-deck';
import { checkRateLimit, getClientIp, createRateLimitHeaders, RATE_LIMITS } from '@/lib/rate-limit';

// Language stats change rarely — cache aggressively
const CACHE_CONTROL = 'public, max-age=21600, stale-while-revalidate=21600';

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

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const deckId = await resolveDeckId(vnId, controller.signal);
    if (!deckId) {
      clearTimeout(timeoutId);
      return NextResponse.json(null, {
        headers: { 'Cache-Control': CACHE_CONTROL },
      });
    }

    const res = await fetch(
      `https://api.jiten.moe/api/media-deck/${deckId}/detail`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json(null, {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': CACHE_CONTROL },
    });
  } catch {
    return NextResponse.json(null, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
