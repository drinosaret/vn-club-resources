import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, createRateLimitHeaders, RATE_LIMITS } from '@/lib/rate-limit';
import { fetchByDifficulty, type DifficultyVN } from '../jiten-utils';

// Reads the local difficulty mirror rather than jiten.moe directly. The mirror is refreshed
// with every import, so it trails the upstream by at most a day, and the panel still renders
// when the upstream is unreachable.
const CACHE_CONTROL = 'public, max-age=7200, stale-while-revalidate=3600';
const MAX_RESULTS = 10;

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(`jiten:${getClientIp(request)}`, RATE_LIMITS.externalProxy);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(null, {
      status: 429,
      headers: { ...createRateLimitHeaders(rateLimitResult), 'Cache-Control': 'no-store' },
    });
  }

  const { searchParams } = new URL(request.url);
  const difficultyStr = searchParams.get('difficulty');
  const exclude = searchParams.get('exclude');

  if (!difficultyStr) {
    return NextResponse.json(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const difficulty = parseFloat(difficultyStr);
  if (isNaN(difficulty)) {
    return NextResponse.json(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    // The query orders by closeness, so one page of results is already the nearest set.
    const results: DifficultyVN[] = await fetchByDifficulty({
      near_difficulty: difficulty,
      exclude: exclude ?? undefined,
      limit: MAX_RESULTS,
    });

    return NextResponse.json(results, {
      headers: { 'Cache-Control': CACHE_CONTROL },
    });
  } catch {
    return NextResponse.json(null, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
