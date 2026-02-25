import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import sharp from 'sharp';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

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
  'www.ima-ero.com',
];

// Cache configuration
const MAX_AGE_DAYS = 30;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const EVICT_AGE_MS = 90 * 24 * 60 * 60 * 1000; // Delete files older than 90 days
const EVICT_PROBABILITY = 0.01; // Run cleanup ~1% of cache writes
const WEBP_QUALITY = 80;

// Security limits
const FETCH_TIMEOUT_MS = 10000; // 10 second timeout
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB max

// In-flight fetch deduplication
const inflightFetches = new Map<string, Promise<Buffer | null>>();

/**
 * Get the cache directory for proxied images.
 * Uses PROXY_CACHE_DIR env var, or falls back to ~/.vnclub/proxy-cache/
 */
function getCacheDir(): string {
  const dir = process.env.PROXY_CACHE_DIR;
  if (dir) return path.resolve(dir);
  return path.join(os.homedir(), '.vnclub', 'proxy-cache');
}

/**
 * Generate a cache file path from a URL using SHA-256 hash.
 */
function getCachePath(url: string): string {
  const hash = crypto.createHash('sha256').update(url).digest('hex');
  // Use first 2 chars as subdirectory to avoid too many files in one dir
  return path.join(getCacheDir(), hash.slice(0, 2), `${hash}.webp`);
}

/**
 * Check if a cached file is stale (older than MAX_AGE_DAYS)
 */
async function isCacheStale(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return Date.now() - stats.mtimeMs > MAX_AGE_MS;
  } catch {
    return true;
  }
}

/**
 * Ensure the directory structure exists for a file path
 */
async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

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

/**
 * Fetch image from source, convert to WebP, and save to cache.
 * Deduplicates concurrent requests for the same URL.
 * Rate limiting is checked by the caller so cache hits bypass it entirely.
 */
async function fetchAndCacheImage(
  url: string,
  cachePath: string,
): Promise<Buffer | null> {
  const existing = inflightFetches.get(url);
  if (existing) return existing;

  const promise = doFetchAndCache(url, cachePath);
  inflightFetches.set(url, promise);
  try {
    return await promise;
  } finally {
    inflightFetches.delete(url);
  }
}

/** Internal: performs the actual fetch and disk cache write. */
async function doFetchAndCache(
  url: string,
  cachePath: string,
): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VN-Club-Resources/1.0)',
        'Accept': 'image/*',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE_BYTES) {
      return null;
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
      return null;
    }

    // Convert to WebP and cache
    await ensureDir(cachePath);
    const webpBuffer = await sharp(buffer)
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    await fs.writeFile(cachePath, webpBuffer);

    // Probabilistic cache eviction — runs ~1% of writes to avoid unbounded growth
    if (Math.random() < EVICT_PROBABILITY) {
      evictStaleCache().catch(() => {});
    }

    return webpBuffer;
  } catch {
    return null;
  }
}

/**
 * Delete cached files older than 90 days. Runs in the background
 * on a small fraction of cache writes to keep disk usage bounded.
 */
async function evictStaleCache(): Promise<void> {
  const cacheDir = getCacheDir();
  const now = Date.now();
  let subdirs: string[];
  try {
    subdirs = await fs.readdir(cacheDir);
  } catch {
    return;
  }
  for (const sub of subdirs) {
    const subPath = path.join(cacheDir, sub);
    let files: string[];
    try {
      files = await fs.readdir(subPath);
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const filePath = path.join(subPath, file);
        const stats = await fs.stat(filePath);
        if (now - stats.mtimeMs > EVICT_AGE_MS) {
          await fs.unlink(filePath);
        }
      } catch {
        // File may have been deleted concurrently
      }
    }
  }
}

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);

  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json(
      { error: 'Missing url parameter' },
      { status: 400 }
    );
  }

  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch {
    return NextResponse.json(
      { error: 'Invalid URL encoding' },
      { status: 400 }
    );
  }

  if (!isAllowedUrl(decodedUrl)) {
    return NextResponse.json(
      { error: 'Domain not allowed' },
      { status: 403 }
    );
  }

  const cachePath = getCachePath(decodedUrl);

  // Check disk cache
  let cachedBuffer: Buffer | null = null;
  let isStale = true;

  try {
    cachedBuffer = await fs.readFile(cachePath);
    isStale = await isCacheStale(cachePath);
  } catch {
    // Cache miss
  }

  // Cache hit — serve immediately (no rate limit check)
  if (cachedBuffer && !isStale) {
    return new NextResponse(new Uint8Array(cachedBuffer), {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  // Cache miss or stale — check rate limit before fetching from source
  const rateLimitResult = checkRateLimit(`proxy-image:${clientIp}`, RATE_LIMITS.imageProxy);
  if (!rateLimitResult.allowed) {
    // Rate limited — serve stale cache if available, otherwise 429
    if (cachedBuffer) {
      return new NextResponse(new Uint8Array(cachedBuffer), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Disposition': 'inline',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
    const retryAfter = Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000);
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.max(retryAfter, 1)) } }
    );
  }

  const freshBuffer = await fetchAndCacheImage(decodedUrl, cachePath);

  if (freshBuffer) {
    return new NextResponse(new Uint8Array(freshBuffer), {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  // Fetch failed but we have stale cache — serve it as fallback
  if (cachedBuffer) {
    return new NextResponse(new Uint8Array(cachedBuffer), {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  // No cache, fetch failed
  return NextResponse.json(
    { error: 'Failed to proxy image' },
    { status: 502 }
  );
}
