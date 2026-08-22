import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, createRateLimitHeaders, RATE_LIMITS } from '@/lib/rate-limit';
import { fetchByDifficulty, type DifficultyVN } from '../jiten-utils';

// Reads the local difficulty mirror rather than jiten.moe directly; see similar-difficulty
// for the reasoning.
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
  const characterCountStr = searchParams.get('characterCount');
  const exclude = searchParams.get('exclude');

  if (!characterCountStr) {
    return NextResponse.json(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const characterCount = parseInt(characterCountStr, 10);
  if (isNaN(characterCount) || characterCount < 0) {
    return NextResponse.json(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const results: DifficultyVN[] = await fetchByDifficulty({
      near_characters: characterCount,
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
