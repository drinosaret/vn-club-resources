import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, createRateLimitHeaders, RATE_LIMITS } from '@/lib/rate-limit';

// Cache for 10 minutes
const CACHE_MAX_AGE = 600;

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

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(
      `https://api.jiten.moe/api/media-deck/by-link-id/2/${vnId}`,
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
      headers: { 'Cache-Control': `public, max-age=${CACHE_MAX_AGE}` },
    });
  } catch {
    return NextResponse.json(null, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
