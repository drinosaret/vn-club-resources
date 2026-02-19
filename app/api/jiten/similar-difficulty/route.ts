import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, createRateLimitHeaders, RATE_LIMITS } from '@/lib/rate-limit';
import { fetchCovers, type JitenMediaDeck, extractVnId } from '../jiten-utils';

const CACHE_MAX_AGE = 3600;
const DIFFICULTY_RANGE = 0.5;
const MAX_RESULTS = 10;

interface SimilarDifficultyVN {
  vnId: string;
  title: string;
  titleJp: string;
  difficulty: number;
  coverUrl: string | null;
  imageSexual: number;
}

function deckToVN(deck: JitenMediaDeck): SimilarDifficultyVN | null {
  const vnId = extractVnId(deck);
  if (!vnId) return null;
  return {
    vnId,
    title: deck.englishTitle || deck.romajiTitle || deck.originalTitle,
    titleJp: deck.originalTitle,
    difficulty: deck.difficultyRaw,
    coverUrl: null,
    imageSexual: 0,
  };
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const min = Math.max(0, difficulty - DIFFICULTY_RANGE);
    const max = Math.min(5, difficulty + DIFFICULTY_RANGE);

    // Fetch from both directions to avoid pagination bias:
    // - Lower range sorted descending (closest to target first)
    // - Upper range sorted ascending (closest to target first)
    const [lowerRes, upperRes] = await Promise.all([
      fetch(
        `https://api.jiten.moe/api/media-deck/get-media-decks?offset=0&mediaType=7&difficultyMin=${min}&difficultyMax=${difficulty}&sortBy=difficulty&sortOrder=1`,
        { signal: controller.signal }
      ),
      fetch(
        `https://api.jiten.moe/api/media-deck/get-media-decks?offset=0&mediaType=7&difficultyMin=${difficulty}&difficultyMax=${max}&sortBy=difficulty&sortOrder=0`,
        { signal: controller.signal }
      ),
    ]);
    clearTimeout(timeoutId);

    const lowerDecks: JitenMediaDeck[] = lowerRes.ok ? ((await lowerRes.json()).data ?? []) : [];
    const upperDecks: JitenMediaDeck[] = upperRes.ok ? ((await upperRes.json()).data ?? []) : [];

    // Merge, deduplicate, sort by proximity
    const seen = new Set<string>();
    const allVNs: SimilarDifficultyVN[] = [];

    for (const deck of [...lowerDecks, ...upperDecks]) {
      const vn = deckToVN(deck);
      if (!vn || vn.vnId === exclude || seen.has(vn.vnId)) continue;
      seen.add(vn.vnId);
      allVNs.push(vn);
    }

    allVNs.sort((a, b) => Math.abs(a.difficulty - difficulty) - Math.abs(b.difficulty - difficulty));
    const results = allVNs.slice(0, MAX_RESULTS);

    // Fetch VNDB cover URLs and sexual ratings for the final results
    const covers = await fetchCovers(results.map(v => v.vnId));
    for (const vn of results) {
      const info = covers.get(vn.vnId);
      if (info) {
        vn.coverUrl = info.url;
        vn.imageSexual = info.sexual;
      }
    }

    return NextResponse.json(results, {
      headers: { 'Cache-Control': `public, max-age=${CACHE_MAX_AGE}` },
    });
  } catch {
    return NextResponse.json(null, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
