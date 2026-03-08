import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, createRateLimitHeaders, RATE_LIMITS } from '@/lib/rate-limit';
import { fetchCovers, type JitenMediaDeck, extractVnId } from '../jiten-utils';

const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=600';
const RESULTS_COUNT = 10;
const NSFW_THRESHOLD = 1.5;

// In-memory pool cache — refreshed every 10 minutes from jiten.moe.
// Eliminates per-request jiten.moe dependency (Node fetch to jiten is flaky).
const POOL_TTL = 10 * 60 * 1000;
let cachedPool: EasyVN[] = [];
let poolFetchedAt = 0;
let poolRefreshing = false;

interface EasyVN {
  vnId: string;
  title: string;
  titleJp: string;
  difficulty: number;
  characterCount: number;
  coverUrl: string | null;
  imageSexual: number;
}

function deckToVN(deck: JitenMediaDeck): EasyVN | null {
  const vnId = extractVnId(deck);
  if (!vnId) return null;
  return {
    vnId,
    title: deck.englishTitle || deck.romajiTitle || deck.originalTitle,
    titleJp: deck.originalTitle,
    difficulty: deck.difficultyRaw,
    characterCount: deck.characterCount,
    coverUrl: null,
    imageSexual: 0,
  };
}

// Fisher-Yates shuffle
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchJitenPage(offset: number): Promise<JitenMediaDeck[]> {
  // Retry up to 3 times — Node.js fetch to jiten.moe is flaky (~37% failure)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `https://api.jiten.moe/api/media-deck/get-media-decks?offset=${offset}&limit=50&mediaType=7&difficultyMin=0&difficultyMax=2&sortBy=difficulty&sortOrder=0`,
        { signal: AbortSignal.timeout(10000), cache: 'no-store' },
      );
      if (!res.ok) continue;
      const body = await res.json();
      const data = body.data ?? [];
      if (data.length > 0) return data;
    } catch {
      // Retry on network/timeout errors
    }
  }
  return [];
}

/** Build a large pool by fetching multiple pages from jiten.moe. */
async function buildPool(excludeSet: Set<string>): Promise<EasyVN[]> {
  // Fetch 3 pages at different offsets to cover the full 0–2 difficulty range
  // Pages are fetched sequentially to avoid connection issues
  const offsets = [0, 50, 100];
  const allDecks: JitenMediaDeck[] = [];

  for (const offset of offsets) {
    const decks = await fetchJitenPage(offset);
    allDecks.push(...decks);
  }

  const seen = new Set<string>();
  const vns: EasyVN[] = [];
  for (const deck of allDecks) {
    const vn = deckToVN(deck);
    if (!vn || excludeSet.has(vn.vnId) || seen.has(vn.vnId)) continue;
    seen.add(vn.vnId);
    vns.push(vn);
  }

  return vns;
}

/** Get or refresh the cached pool. */
async function getPool(excludeSet: Set<string>): Promise<EasyVN[]> {
  const now = Date.now();
  if (cachedPool.length > 0 && now - poolFetchedAt < POOL_TTL) {
    // Return cached, filtering excludes
    return cachedPool.filter((v) => !excludeSet.has(v.vnId));
  }

  // Prevent concurrent refreshes
  if (poolRefreshing && cachedPool.length > 0) {
    return cachedPool.filter((v) => !excludeSet.has(v.vnId));
  }

  poolRefreshing = true;
  try {
    const pool = await buildPool(excludeSet);
    if (pool.length > 0) {
      cachedPool = pool;
      poolFetchedAt = now;
    }
    return pool.length > 0 ? pool : cachedPool.filter((v) => !excludeSet.has(v.vnId));
  } finally {
    poolRefreshing = false;
  }
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
  const excludeStr = searchParams.get('exclude') ?? '';
  const excludeSet = new Set(excludeStr.split(',').filter(Boolean));

  try {
    const pool = await getPool(excludeSet);

    // Over-fetch to compensate for NSFW filtering (~60% buffer)
    const FETCH_COUNT = Math.ceil(RESULTS_COUNT * 1.6);

    // Split by difficulty and balance the selection
    const easy = shuffle(pool.filter((v) => v.difficulty < 1.5));
    const moderate = shuffle(pool.filter((v) => v.difficulty >= 1.5));

    // Take roughly half from each bucket, fill remainder from whichever has more
    const mixed: EasyVN[] = [];
    const half = Math.ceil(FETCH_COUNT / 2);
    mixed.push(...easy.slice(0, half));
    mixed.push(...moderate.slice(0, half));

    if (mixed.length < FETCH_COUNT) {
      const usedIds = new Set(mixed.map((v) => v.vnId));
      const extras = [...easy, ...moderate].filter((v) => !usedIds.has(v.vnId));
      mixed.push(...extras.slice(0, FETCH_COUNT - mixed.length));
    }

    const combined = shuffle(mixed);

    // Fetch VNDB cover URLs and sexual ratings (non-blocking)
    try {
      const covers = await fetchCovers(combined.map((v) => v.vnId));
      for (const vn of combined) {
        const info = covers.get(vn.vnId);
        if (info) {
          vn.coverUrl = info.url;
          vn.imageSexual = info.sexual;
        }
      }
    } catch {
      // Covers unavailable — VNs still render with placeholder images
    }

    // Filter out NSFW covers
    const results = combined
      .filter((vn) => vn.imageSexual < NSFW_THRESHOLD)
      .slice(0, RESULTS_COUNT);

    return NextResponse.json(results, { headers: { 'Cache-Control': CACHE_CONTROL } });
  } catch {
    return NextResponse.json(null, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
