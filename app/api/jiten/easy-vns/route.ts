import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, createRateLimitHeaders, RATE_LIMITS } from '@/lib/rate-limit';
import { fetchByDifficulty, type DifficultyVN } from '../jiten-utils';

/**
 * A rotating selection of visual novels a beginner can actually read.
 *
 * Reads the local difficulty mirror rather than paging jiten.moe. The whole easy range is one
 * indexed query, so there is nothing worth holding in the process between requests, and no
 * window in which the page renders empty because the upstream is unreachable.
 */
const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=600';
const RESULTS_COUNT = 10;
const NSFW_THRESHOLD = 1.5;

//: The upper end of "a beginner could read this", and the split between the two halves the
//: selection is balanced across so the list is not all of the very easiest titles.
const MAX_DIFFICULTY = 2;
const EASY_BELOW = 1.5;

//: Enough of the range to shuffle meaningfully without reading the whole table.
const POOL_SIZE = 100;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(`jiten:${getClientIp(request)}`, RATE_LIMITS.externalProxy);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(null, {
      status: 429,
      headers: { ...createRateLimitHeaders(rateLimitResult), 'Cache-Control': 'no-store' },
    });
  }

  const { searchParams } = new URL(request.url);
  const exclude = searchParams.get('exclude') ?? '';

  try {
    const pool = await fetchByDifficulty({
      max_difficulty: MAX_DIFFICULTY,
      exclude: exclude || undefined,
      limit: POOL_SIZE,
    });

    // Over-fetch, because the adult-cover filter below removes an unpredictable share.
    const target = Math.ceil(RESULTS_COUNT * 1.6);

    // Balanced across the two halves of the range rather than taken straight off the top,
    // which would return the same handful of very easiest titles on every visit.
    const easy = shuffle(pool.filter((v) => v.difficulty < EASY_BELOW));
    const moderate = shuffle(pool.filter((v) => v.difficulty >= EASY_BELOW));

    const half = Math.ceil(target / 2);
    const mixed: DifficultyVN[] = [...easy.slice(0, half), ...moderate.slice(0, half)];

    if (mixed.length < target) {
      const used = new Set(mixed.map((v) => v.vnId));
      mixed.push(
        ...[...easy, ...moderate].filter((v) => !used.has(v.vnId)).slice(0, target - mixed.length),
      );
    }

    const results = shuffle(mixed)
      .filter((vn) => vn.imageSexual < NSFW_THRESHOLD)
      .slice(0, RESULTS_COUNT);

    return NextResponse.json(results, { headers: { 'Cache-Control': CACHE_CONTROL } });
  } catch {
    return NextResponse.json(null, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
