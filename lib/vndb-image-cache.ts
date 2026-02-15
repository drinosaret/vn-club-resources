/**
 * VNDB Image Cache Helper
 *
 * Converts VNDB image URLs to local cached paths to avoid hotlinking.
 * Images are stored in .cache/vndb/ and served via the /img/ API route.
 * Also handles Twitter CDN images via proxy.
 */

// Valid VNDB image path prefixes
const ALLOWED_PREFIXES = ['cv', 'ch', 'sf'] as const;
type VNDBImagePrefix = typeof ALLOWED_PREFIXES[number];

// Valid image extensions
const ALLOWED_EXTENSIONS = ['.jpg', '.webp'] as const;

/**
 * Validates that a URL is a legitimate VNDB image URL
 */
export function isValidVNDBImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Must be from t.vndb.org
    if (parsed.hostname !== 't.vndb.org') {
      return false;
    }

    // Path must match pattern: /{prefix}/{subdir}/{id}.{ext}
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length !== 3) {
      return false;
    }

    const [prefix, subdir, filename] = pathParts;

    // Validate prefix
    if (!ALLOWED_PREFIXES.includes(prefix as VNDBImagePrefix)) {
      return false;
    }

    // Validate subdir (should be 2 digits)
    if (!/^\d{2}$/.test(subdir)) {
      return false;
    }

    // Validate filename (should be digits followed by allowed extension)
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => filename.endsWith(ext));
    if (!hasValidExtension) {
      return false;
    }

    const nameWithoutExt = filename.replace(/\.(jpg|webp)$/, '');
    if (!/^\d+$/.test(nameWithoutExt)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts the cache path from a VNDB image URL
 *
 * @example
 * getCachePathFromUrl('https://t.vndb.org/cv/12/12345.jpg')
 * // Returns: 'cv/12/12345.jpg'
 */
export function getCachePathFromUrl(url: string): string | null {
  if (!isValidVNDBImageUrl(url)) {
    return null;
  }

  try {
    const parsed = new URL(url);
    // Remove leading slash
    return parsed.pathname.slice(1);
  } catch {
    return null;
  }
}

// Allowed image widths for resizing (must match route.ts)
export type ImageWidth = 128 | 256 | 512;

/**
 * Options for getProxiedImageUrl
 */
export interface ProxiedImageOptions {
  /** Optional width for resized variant (128, 256, or 512) */
  width?: ImageWidth;
  /** Optional VN ID for blacklist checking (required for cover images) */
  vnId?: string;
}

/**
 * Converts a VNDB image URL to a local cached image URL
 *
 * Behavior controlled by environment:
 * - VNDB_IMAGE_MODE='api': Always use API route for on-demand caching (default for Railway/Docker)
 * - VNDB_IMAGE_MODE='static': Use pre-cached static files (for GitHub Pages or pre-built cache)
 * - Development: Always uses API route
 *
 * @param vndbUrl - The original VNDB image URL
 * @param options - Optional width and VN ID for blacklist checking
 *
 * @example
 * getProxiedImageUrl('https://t.vndb.org/cv/12/12345.jpg')
 * // Returns: '/img/cv/12/12345.webp'
 *
 * getProxiedImageUrl('https://t.vndb.org/cv/12/12345.jpg', { width: 256 })
 * // Returns: '/img/cv/12/12345.webp?w=256'
 *
 * getProxiedImageUrl('https://t.vndb.org/cv/12/12345.jpg', { vnId: 'v535' })
 * // Returns: '/img/cv/12/12345.webp?vn=v535'
 */
export function getProxiedImageUrl(
  vndbUrl: string | null | undefined,
  options?: ImageWidth | ProxiedImageOptions
): string | null {
  if (!vndbUrl) {
    return null;
  }

  const cachePath = getCachePathFromUrl(vndbUrl);
  if (!cachePath) {
    // Not a valid VNDB URL — return null to avoid passing untrusted URLs through
    return null;
  }

  // Handle both old (width only) and new (options object) signatures
  const width = typeof options === 'number' ? options : options?.width;
  const vnId = typeof options === 'object' ? options?.vnId : undefined;

  const webpPath = cachePath.replace(/\.(jpg|jpeg)$/i, '.webp');

  // Build query string
  const queryParams: string[] = [];
  if (width) queryParams.push(`w=${width}`);
  if (vnId) queryParams.push(`vn=${vnId}`);
  const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

  // Use API route for on-demand caching in these cases:
  // 1. Development mode
  // 2. VNDB_IMAGE_MODE explicitly set to 'api'
  // 3. Production without pre-built static cache (default for Railway/Docker)
  const useApiRoute =
    process.env.NODE_ENV === 'development' ||
    process.env.VNDB_IMAGE_MODE === 'api' ||
    (process.env.NODE_ENV === 'production' && process.env.VNDB_IMAGE_MODE !== 'static');

  if (useApiRoute) {
    return `/img/${webpPath}${queryString}`;
  }

  // Static mode: return direct path to WebP cached file
  // Width parameter is ignored in static mode (would need pre-generated variants)
  return `/cache/vndb/${webpPath}`;
}

/**
 * Gets the local filesystem path for a cached image
 * Used by the API route to read/write cached files
 */
export function getLocalCachePath(cachePath: string): string {
  // This will be resolved relative to the project root in the API route
  return `.cache/vndb/${cachePath}`;
}

/**
 * Validates path segments to prevent path traversal attacks
 */
export function validatePathSegments(segments: string[]): boolean {
  if (segments.length !== 3) {
    return false;
  }

  const [prefix, subdir, filename] = segments;

  // Check for path traversal attempts
  for (const segment of segments) {
    if (segment.includes('..') || segment.includes('/') || segment.includes('\\')) {
      return false;
    }
  }

  // Validate prefix
  if (!ALLOWED_PREFIXES.includes(prefix as VNDBImagePrefix)) {
    return false;
  }

  // Validate subdir (2 digits)
  if (!/^\d{2}$/.test(subdir)) {
    return false;
  }

  // Validate filename
  const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => filename.endsWith(ext));
  if (!hasValidExtension) {
    return false;
  }

  const nameWithoutExt = filename.replace(/\.(jpg|webp)$/, '');
  if (!/^\d+$/.test(nameWithoutExt)) {
    return false;
  }

  return true;
}

/**
 * Builds the VNDB source URL from path segments
 * VNDB only serves JPG, so convert .webp requests back to .jpg
 */
export function buildVNDBUrl(segments: string[]): string {
  const path = segments.join('/').replace(/\.webp$/i, '.jpg');
  return `https://t.vndb.org/${path}`;
}

/** Swap width param to create a 20px micro-thumbnail for NSFW mosaic censor.
 *  Upscaled with pixelated rendering = mosaic effect, zero GPU cost vs CSS blur. */
export function getTinySrc(src: string): string {
  if (src.includes('w=')) {
    return src.replace(/w=\d+/, 'w=20');
  }
  return src + (src.includes('?') ? '&' : '?') + 'w=20';
}

// Twitter CDN domains that need proxying
const TWITTER_CDN_DOMAINS = [
  'pbs.twimg.com',
  'video.twimg.com',
  'ton.twimg.com',
  'abs.twimg.com',
];

/**
 * Checks if a URL is from Twitter CDN
 */
export function isTwitterImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return TWITTER_CDN_DOMAINS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Gets the appropriate image URL for news items.
 * - VNDB images: routes through /img/ for caching
 * - Twitter images: routes through /api/proxy-image/ to avoid CORS
 * - Other URLs: returned as-is
 */
export function getNewsImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) {
    return null;
  }

  // Check for VNDB URLs first
  const cachePath = getCachePathFromUrl(imageUrl);
  if (cachePath) {
    // Use existing VNDB proxy logic
    return getProxiedImageUrl(imageUrl);
  }

  // Check for Twitter CDN URLs
  if (isTwitterImageUrl(imageUrl)) {
    return `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
  }

  // Route other external URLs through proxy to avoid CSP issues
  return `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
}
