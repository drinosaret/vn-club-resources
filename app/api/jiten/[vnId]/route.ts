import { NextRequest, NextResponse } from 'next/server';

// Cache for 10 minutes
const CACHE_MAX_AGE = 600;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ vnId: string }> }
) {
  const { vnId } = await params;

  // Basic validation: vnId should look like "v" + digits
  if (!/^v\d+$/.test(vnId)) {
    return NextResponse.json([], {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
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
      return NextResponse.json([], {
        headers: { 'Cache-Control': `public, max-age=${CACHE_MAX_AGE}` },
      });
    }

    const data = await res.json();

    return NextResponse.json(data, {
      headers: { 'Cache-Control': `public, max-age=${CACHE_MAX_AGE}` },
    });
  } catch {
    return NextResponse.json([], {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  }
}
