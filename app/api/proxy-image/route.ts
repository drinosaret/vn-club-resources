import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import sharp from 'sharp';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

// Allowed domains for external image proxying. The second group holds the image hosts of
// the news sources the backend ingests: a feed added there without its host here leaves
// every card from that source falling back to a favicon.
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
  'moepedia.net',
  'www.inside-games.jp',
  'news.denfaminicogamer.jp',
  'www.bugbug.news',
  'www.otomate-p.jp',
  'www.moe-gameaward.com',
  'i.ytimg.com',
  'cdn.bsky.app',
  'shared.fastly.steamstatic.com',
  'shared.akamai.steamstatic.com',
  'img.dlsite.jp',
  'www.getchu.com',
  'img.digiket.net',
  'booth.pximg.net',
  'melonbooks.akamaized.net',
  'fpiccdn.com',
  'i.4cdn.org',
  'assets.st-note.com',
  'cdn.jiten.moe',
  'image.gamespark.jp',
  'www.gamespark.jp',
  'cimg.kgl-systems.io',
  'image.gamer.ne.jp',
];

// Beyond the fixed list, a URL is served when the news aggregator recorded it as some
// item's picture. Answers are held for a while so a page of thumbnails asks once each.
const REFERENCE_CHECK_TIMEOUT_MS = 3000;
const REFERENCE_TTL_MS = 60 * 60 * 1000;
const referenceCache = new Map<string, { allowed: boolean; at: number }>();

// Some stores serve their pictures only to requests that arrive from their own pages.
const REFERER_HOSTS: Record<string, string> = {
  'www.getchu.com': 'https://www.getchu.com/',
  'booth.pximg.net': 'https://booth.pm/',
};

function refererFor(url: string): Record<string, string> {
  try {
    const referer = REFERER_HOSTS[new URL(url).hostname];
    return referer ? { Referer: referer } : {};
  } catch {
    return {};
  }
}

// The sizes a caller may ask for. The smallest is the pixelated stand-in behind a blur.
const ALLOWED_WIDTHS = [20, 256, 512] as const;

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
function getCachePath(url: string, width?: number): string {
  const hash = crypto.createHash('sha256').update(url).digest('hex');
  // Use first 2 chars as subdirectory to avoid too many files in one dir
  const name = width ? `${hash}-w${width}.webp` : `${hash}.webp`;
  return path.join(getCacheDir(), hash.slice(0, 2), name);
}

function backendBase(): string | null {
  const base = process.env.API_URL_INTERNAL || process.env.NEXT_PUBLIC_VNDB_STATS_API;
  return base ? base.replace(/\/$/, '') : null;
}

/**
 * A public https origin on the default port. Address literals and local names are refused
 * outright, since a feed's picture URL is third-party input and this fetch runs on the server.
 */
function isPublicHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.port !== '' && parsed.port !== '443') return false;
    const host = parsed.hostname.toLowerCase();
    if (!host.includes('.')) return false;
    if (/^[\d.]+$/.test(host) || host.startsWith('[') || host.endsWith('.local') || host.endsWith('.localhost')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function isReferencedNewsImage(url: string): Promise<boolean> {
  const hit = referenceCache.get(url);
  if (hit && Date.now() - hit.at < REFERENCE_TTL_MS) return hit.allowed;
  const base = backendBase();
  if (!base) return false;
  let allowed = false;
  try {
    const res = await fetch(`${base}/api/v1/news/image-check?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(REFERENCE_CHECK_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as { allowed?: boolean };
      allowed = data.allowed === true;
    }
  } catch {
    allowed = false;
  }
  if (referenceCache.size > 5000) referenceCache.clear();
  referenceCache.set(url, { allowed, at: Date.now() });
  return allowed;
}

/** The fixed host list, or a public https picture the aggregator recorded. */
async function isPermittedUrl(url: string): Promise<boolean> {
  if (isAllowedUrl(url)) return true;
  if (!isPublicHttpsUrl(url)) return false;
  return isReferencedNewsImage(url);
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
      (parsed.port === '' || parsed.port === '443') &&
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
    // The check is repeated at the point of use, so this server-side fetch depends on no
    // caller having validated the address first.
    if (!(await isPermittedUrl(url))) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VN-Club-Resources/1.0)',
        'Accept': 'image/*',
        ...refererFor(url),
      },
      signal: controller.signal,
      // Don't follow redirects: an open redirect on an allowlisted host could
      // otherwise send this server-side fetch to an internal address (SSRF).
      // A 3xx becomes a non-ok opaqueredirect and is rejected below.
      redirect: 'manual',
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

    // Probabilistic cache eviction: runs ~1% of writes to avoid unbounded growth
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

  if (!(await isPermittedUrl(decodedUrl))) {
    return NextResponse.json(
      { error: 'Domain not allowed' },
      { status: 403 }
    );
  }

  const rawWidth = request.nextUrl.searchParams.get('w');
  const width = rawWidth ? Number(rawWidth) : undefined;
  if (width !== undefined && !ALLOWED_WIDTHS.includes(width as (typeof ALLOWED_WIDTHS)[number])) {
    return NextResponse.json({ error: 'Unsupported width' }, { status: 400 });
  }

  const cachePath = getCachePath(decodedUrl);

  // A sized variant is derived from the cached full image and cached beside it.
  if (width) {
    const variantPath = getCachePath(decodedUrl, width);
    try {
      const variant = await fs.readFile(variantPath);
      if (!(await isCacheStale(variantPath))) {
        return new NextResponse(new Uint8Array(variant), {
          headers: {
            'Content-Type': 'image/webp',
            'Content-Disposition': 'inline',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }
    } catch {
      // No variant yet
    }
    let base: Buffer | null = null;
    try {
      base = await fs.readFile(cachePath);
    } catch {
      const rateLimitResult = checkRateLimit(`proxy-image:${clientIp}`, RATE_LIMITS.imageProxy);
      if (rateLimitResult.allowed) {
        base = await fetchAndCacheImage(decodedUrl, cachePath);
      }
    }
    if (!base) {
      return NextResponse.json({ error: 'Failed to fetch image' }, { status: 502 });
    }
    try {
      const resized = await sharp(base)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
      await ensureDir(variantPath);
      await fs.writeFile(variantPath, resized);
      return new NextResponse(new Uint8Array(resized), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Disposition': 'inline',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      return NextResponse.json({ error: 'Failed to resize image' }, { status: 502 });
    }
  }

  // Check disk cache
  let cachedBuffer: Buffer | null = null;
  let isStale = true;

  try {
    cachedBuffer = await fs.readFile(cachePath);
    isStale = await isCacheStale(cachePath);
  } catch {
    // Cache miss
  }

  // Cache hit: serve immediately (no rate limit check)
  if (cachedBuffer && !isStale) {
    return new NextResponse(new Uint8Array(cachedBuffer), {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  // Cache miss or stale: check rate limit before fetching from source
  const rateLimitResult = checkRateLimit(`proxy-image:${clientIp}`, RATE_LIMITS.imageProxy);
  if (!rateLimitResult.allowed) {
    // Rate limited: serve stale cache if available, otherwise 429
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

  // Fetch failed but we have stale cache; serve it as fallback
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
