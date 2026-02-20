import { NextRequest, NextResponse } from 'next/server';
import { resolveDeckId } from '../resolve-deck';

// Deck ID mappings essentially never change — cache aggressively
const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=86400';

export async function GET(
  _request: NextRequest,
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

  try {
    // resolveDeckId has its own 24-hour server-side cache,
    // so this won't spam the upstream jiten.moe API.
    const deckId = await resolveDeckId(vnId);
    const data = deckId ? [deckId] : [];

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
