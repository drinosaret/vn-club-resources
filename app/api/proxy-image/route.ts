import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, createRateLimitHeaders, RATE_LIMITS } from '@/lib/rate-limit';

// Allowed domains for external image proxying
const ALLOWED_DOMAINS = [
  'pbs.twimg.com',
  'video.twimg.com',
  'ton.twimg.com',
  'abs.twimg.com',
  'www.4gamer.net',
  'automaton-media.com',
  'www.automaton-media.com',
  'game.watch.impress.co.jp',
  'asset.watch.impress.co.jp',
];

// Cache duration: 1 day
const CACHE_MAX_AGE = 86400;

// Security limits
const FETCH_TIMEOUT_MS = 10000; // 10 second timeout
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB max

/**
 * Validates that a URL is from an allowed domain
 */
function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      ALLOWED_DOMAINS.includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  // Rate limiting
  const clientIp = getClientIp(request);
  const rateLimitResult = checkRateLimit(`proxy-image:${clientIp}`, RATE_LIMITS.imageProxy);

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: createRateLimitHeaders(rateLimitResult) }
    );
  }

  const url = request.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { error: 'Missing url parameter' },
      { status: 400 }
    );
  }

  // Decode the URL if it was encoded
  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch {
    return NextResponse.json(
      { error: 'Invalid URL encoding' },
      { status: 400 }
    );
  }

  // Validate the URL is from an allowed domain
  if (!isAllowedUrl(decodedUrl)) {
    return NextResponse.json(
      { error: 'Domain not allowed' },
      { status: 403 }
    );
  }

  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VN-Club-Resources/1.0)',
        'Accept': 'image/*',
      },
      signal: controller.signal,
      redirect: 'manual',
    });

    clearTimeout(timeoutId);

    // Reject redirects to prevent SSRF via open redirects on allowed domains
    if (response.status >= 300 && response.status < 400) {
      return NextResponse.json(
        { error: 'Redirects not allowed' },
        { status: 403 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch image' },
        { status: response.status }
      );
    }

    // Check content-length header to reject oversized responses early
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'Image too large' },
        { status: 413 }
      );
    }

    // Verify content type is an image
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Not an image' },
        { status: 400 }
      );
    }

    const buffer = await response.arrayBuffer();

    // Double-check actual size after download (in case content-length was missing/wrong)
    if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'Image too large' },
        { status: 413 }
      );
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=86400`,
        ...createRateLimitHeaders(rateLimitResult),
      },
    });
  } catch (error) {
    console.error('Proxy image fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to proxy image' },
      { status: 502 }
    );
  }
}
