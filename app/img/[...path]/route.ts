import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import sharp from 'sharp';
import {
  validatePathSegments,
  buildVNDBUrl,
} from '@/lib/vndb-image-cache';
import {
  isVnBlacklisted,
  extractVnIdFromCoverPath,
} from '@/lib/blacklist-cache';
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// Cache configuration
//
// Default: ~/.vnclub/vndb-cache (outside the project tree).
// Override with VNDB_CACHE_DIR env var.
//
// IMPORTANT: The fallback uses os.homedir() instead of process.cwd() because
// Turbopack statically traces path.join(process.cwd(), ...) and scans every
// matching file at build time. With 190K+ cached images this added ~9 minutes.
function getCacheDir(): string {
  const dir = process.env.VNDB_CACHE_DIR;
  if (dir) return path.resolve(dir);
  return path.join(os.homedir(), '.vnclub', 'vndb-cache');
}

function getPlaceholderDir(): string {
  const dir = process.env.VNDB_CACHE_DIR;
  if (dir) return path.resolve(dir, '..'); // parent of vndb cache
  return path.join(os.homedir(), '.vnclub');
}

const PLACEHOLDER_SVG_PATH = path.join(process.cwd(), 'public', 'assets', 'cover-placeholder.svg');
const MAX_AGE_DAYS = 30;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const WEBP_QUALITY = 80;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB max image size

// In-flight fetch deduplication: concurrent requests for the same VNDB URL
// share a single outbound fetch instead of racing independently.
const inflightFetches = new Map<string, Promise<Buffer | null>>();

// Allowed image widths for resizing
const ALLOWED_WIDTHS = [128, 256, 512] as const;
type AllowedWidth = typeof ALLOWED_WIDTHS[number];

// Content type mapping
const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * Check if a cached file is stale (older than MAX_AGE_DAYS)
 */
async function isCacheStale(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    const ageMs = Date.now() - stats.mtimeMs;
    return ageMs > MAX_AGE_MS;
  } catch {
    // File doesn't exist
    return true;
  }
}

/**
 * Ensure the directory structure exists for a file path
 */
async function ensureDir(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Fetch image from VNDB and save to cache.
 * Deduplicates concurrent requests — if a fetch is already in flight for this
 * URL, callers share the same Promise instead of issuing a duplicate request.
 *
 * Rate limiting is applied here (not at the route level) so that cache hits
 * bypass rate limiting entirely — only outbound VNDB fetches are throttled.
 */
async function fetchAndCacheImage(
  vndbUrl: string,
  cachePath: string,
  clientIp: string
): Promise<Buffer | null> {
  // Rate limit outbound VNDB fetches per client IP.
  // Cache hits never reach this function, so browsing with a warm cache is unlimited.
  const rateLimitResult = checkRateLimit(`vndb-fetch:${clientIp}`, RATE_LIMITS.imageProxy);
  if (!rateLimitResult.allowed) {
    return null; // Caller falls back to stale cache or returns 502
  }

  const existing = inflightFetches.get(vndbUrl);
  if (existing) return existing;

  const promise = doFetchAndCache(vndbUrl, cachePath);
  inflightFetches.set(vndbUrl, promise);
  try {
    return await promise;
  } finally {
    inflightFetches.delete(vndbUrl);
  }
}

/** Internal: performs the actual VNDB fetch and disk cache write. */
async function doFetchAndCache(
  vndbUrl: string,
  cachePath: string
): Promise<Buffer | null> {
  try {
    const response = await fetch(vndbUrl, {
      headers: {
        'User-Agent': 'VN-Club-Resources/1.0 (image caching)',
      },
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (!response.ok) {
      return null;
    }

    // Verify it's actually an image
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return null;
    }

    // Reject oversized responses before downloading
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE_BYTES) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Verify actual size after download
    if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
      return null;
    }

    // Save to cache
    await ensureDir(cachePath);
    await fs.writeFile(cachePath, buffer);

    // Also convert to WebP for optimized serving
    const webpPath = cachePath.replace(/\.(jpg|jpeg)$/i, '.webp');
    if (webpPath !== cachePath) {
      try {
        await sharp(buffer)
          .webp({ quality: WEBP_QUALITY })
          .toFile(webpPath);
      } catch {
        // WebP conversion failed, original is still cached
      }
    }

    return buffer;
  } catch {
    return null;
  }
}

/**
 * Generate a resized variant from a source buffer
 */
async function generateResizedVariant(
  sourceBuffer: Buffer,
  targetWidth: AllowedWidth,
  outputPath: string
): Promise<Buffer | null> {
  try {
    await ensureDir(outputPath);
    const resizedBuffer = await sharp(sourceBuffer)
      .resize(targetWidth, null, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    await fs.writeFile(outputPath, resizedBuffer);
    return resizedBuffer;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Client IP is resolved once and passed to fetchAndCacheImage for rate limiting.
  // Rate limiting is NOT applied here — cache hits are served without limit.
  // Only outbound VNDB fetches (cache misses) are rate-limited inside fetchAndCacheImage.
  const clientIp = getClientIp(request);

  const { path: pathSegments } = await params;

  // Validate path segments
  if (!validatePathSegments(pathSegments)) {
    return NextResponse.json(
      { error: 'Invalid image path' },
      { status: 400 }
    );
  }

  // Parse optional width parameter for resizing
  const widthParam = request.nextUrl.searchParams.get('w');
  const targetWidth: AllowedWidth | null = widthParam && ALLOWED_WIDTHS.includes(Number(widthParam) as AllowedWidth)
    ? (Number(widthParam) as AllowedWidth)
    : null;

  // Get VN ID from query parameter (preferred) or try to extract from path (legacy)
  // The path extraction only works if the cover filename happens to match the VN ID,
  // which is NOT guaranteed. Always pass the VN ID via query param for cover images.
  const vnIdParam = request.nextUrl.searchParams.get('vn');
  const vnId = vnIdParam || extractVnIdFromCoverPath(pathSegments);

  // Check if this is a blacklisted cover
  if (vnId) {
    const isBlacklisted = await isVnBlacklisted(vnId);
    if (isBlacklisted) {
      // Return WebP placeholder image for blacklisted covers
      // Next.js Image component doesn't allow SVGs by default, so we use WebP
      try {
        // Try to read cached WebP placeholder first
        let placeholderBuffer: Buffer;
        try {
          placeholderBuffer = await fs.readFile(path.join(getPlaceholderDir(), 'placeholder.webp'));
        } catch {
          // Generate WebP placeholder from SVG if it doesn't exist
          const svgBuffer = await fs.readFile(PLACEHOLDER_SVG_PATH);
          placeholderBuffer = await sharp(svgBuffer)
            .resize(256, 341) // 3:4 aspect ratio
            .webp({ quality: 80 })
            .toBuffer();
          // Cache it for future requests
          await ensureDir(path.join(getPlaceholderDir(), 'placeholder.webp'));
          await fs.writeFile(path.join(getPlaceholderDir(), 'placeholder.webp'), placeholderBuffer);
        }
        return new NextResponse(new Uint8Array(placeholderBuffer), {
          headers: {
            'Content-Type': 'image/webp',
            'Content-Disposition': 'inline',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } catch (err) {
        console.error('[vndb-image route] Failed to serve placeholder:', err);
        // Placeholder not found, return 404
        return NextResponse.json(
          { error: 'Cover not available' },
          { status: 404 }
        );
      }
    }
  }

  const relativePath = pathSegments.join('/');
  const baseFileName = path.parse(relativePath).name;
  const baseDir = path.dirname(relativePath);

  // Build cache path - include width suffix if resizing
  let cachePath: string;
  if (targetWidth) {
    cachePath = path.join(getCacheDir(), baseDir, `${baseFileName}-w${targetWidth}.webp`);
  } else {
    cachePath = path.join(getCacheDir(), relativePath);
  }

  let extension = targetWidth ? '.webp' : path.extname(relativePath);
  let contentType = targetWidth ? 'image/webp' : (CONTENT_TYPES[extension] || 'image/jpeg');

  // Force refresh requires a secret token to prevent abuse (re-fetching from VNDB)
  const refreshParam = request.nextUrl.searchParams.get('refresh') === '1';
  const refreshSecret = process.env.IMAGE_REFRESH_SECRET;
  const refreshToken = request.headers.get('x-refresh-token') || '';
  const forceRefresh = refreshParam && !!refreshSecret
    && refreshToken.length === refreshSecret.length
    && crypto.timingSafeEqual(Buffer.from(refreshToken), Buffer.from(refreshSecret));

  // Helper paths
  const baseCachePath = path.join(getCacheDir(), relativePath);
  const baseWebpPath = baseCachePath.replace(/\.(jpg|jpeg)$/i, '.webp');
  const baseJpgPath = baseCachePath.replace(/\.webp$/i, '.jpg');

  // ============================================
  // RESIZED IMAGE HANDLING (when ?w= is specified)
  // ============================================
  if (targetWidth) {
    // Check if resized variant already exists and is fresh
    let resizedBuffer: Buffer | null = null;
    let resizedIsStale = true;

    try {
      resizedBuffer = await fs.readFile(cachePath);
      resizedIsStale = await isCacheStale(cachePath);
    } catch {
      // Resized variant doesn't exist yet
    }

    // Return cached resized version if fresh
    if (resizedBuffer && !resizedIsStale && !forceRefresh) {
      return new NextResponse(new Uint8Array(resizedBuffer), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Disposition': 'inline',
          'Cache-Control': 'public, max-age=31536000, immutable',
                    'X-Image-Width': String(targetWidth),
        },
      });
    }

    // Need to generate resized variant - first get the base image
    let sourceBuffer: Buffer | null = null;

    // Try to get base image from cache (prefer WebP, fall back to JPG)
    try {
      sourceBuffer = await fs.readFile(baseWebpPath);
    } catch {
      try {
        sourceBuffer = await fs.readFile(baseJpgPath);
      } catch {
        // No cached base image
      }
    }

    // If no cached base, fetch from VNDB (rate-limited)
    if (!sourceBuffer) {
      const vndbUrl = buildVNDBUrl(pathSegments);
      sourceBuffer = await fetchAndCacheImage(vndbUrl, baseJpgPath, clientIp);
    }

    // Generate resized variant from base
    if (sourceBuffer) {
      const resized = await generateResizedVariant(sourceBuffer, targetWidth, cachePath);
      if (resized) {
        return new NextResponse(new Uint8Array(resized), {
          headers: {
            'Content-Type': 'image/webp',
            'Content-Disposition': 'inline',
            'Cache-Control': 'public, max-age=31536000, immutable',
                        'X-Image-Width': String(targetWidth),
          },
        });
      }
    }

    // If we have a stale resized cache, serve it as fallback
    if (resizedBuffer) {
      return new NextResponse(new Uint8Array(resizedBuffer), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Disposition': 'inline',
          'Cache-Control': 'public, max-age=3600',
                    'X-Image-Width': String(targetWidth),
        },
      });
    }

    // No image available
    return NextResponse.json(
      { error: 'Image not available' },
      { status: 502 }
    );
  }

  // ============================================
  // FULL-SIZE IMAGE HANDLING (original behavior)
  // ============================================

  // PREFER WebP: Check if a WebP version exists for JPG requests
  if (extension === '.jpg' || extension === '.jpeg') {
    try {
      await fs.access(baseWebpPath);
      cachePath = baseWebpPath;
      extension = '.webp';
      contentType = 'image/webp';
    } catch {
      // WebP doesn't exist yet, use original JPG path
    }
  }

  // Handle .webp requests when only .jpg exists (on-demand conversion)
  if (extension === '.webp') {
    try {
      await fs.access(cachePath);
    } catch {
      // WebP doesn't exist, check for JPG source and convert
      try {
        const jpgBuffer = await fs.readFile(baseJpgPath);
        await ensureDir(cachePath);
        await sharp(jpgBuffer)
          .webp({ quality: WEBP_QUALITY })
          .toFile(cachePath);
      } catch {
        // No JPG source either, will need to fetch from VNDB
      }
    }
  }

  // Check if we have a cached version
  let cachedBuffer: Buffer | null = null;
  let isStale = true;

  try {
    cachedBuffer = await fs.readFile(cachePath);
    isStale = await isCacheStale(cachePath);
  } catch {
    // Cache miss - file doesn't exist
  }

  // Return cached version if it exists and is fresh
  if (cachedBuffer && !isStale && !forceRefresh) {
    return new NextResponse(new Uint8Array(cachedBuffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=31536000, immutable',
              },
    });
  }

  // Fetch from VNDB (rate-limited)
  const vndbUrl = buildVNDBUrl(pathSegments);
  const freshBuffer = await fetchAndCacheImage(vndbUrl, baseJpgPath, clientIp);

  if (freshBuffer) {
    // After fresh fetch, prefer the WebP version that was just created
    let serveBuffer = freshBuffer;
    let serveContentType = 'image/jpeg';

    try {
      const webpBuffer = await fs.readFile(baseWebpPath);
      serveBuffer = webpBuffer;
      serveContentType = 'image/webp';
    } catch {
      // WebP wasn't created, serve original
    }

    return new NextResponse(new Uint8Array(serveBuffer), {
      headers: {
        'Content-Type': serveContentType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=31536000, immutable',
              },
    });
  }

  // If fetch failed but we have a stale cache, serve it
  if (cachedBuffer) {
    return new NextResponse(new Uint8Array(cachedBuffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=3600',
              },
    });
  }

  // No cache and fetch failed
  return NextResponse.json(
    { error: 'Image not available' },
    { status: 502 }
  );
}
