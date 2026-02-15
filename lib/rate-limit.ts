/**
 * Simple in-memory rate limiter for API routes.
 *
 * Note: This is an in-memory implementation suitable for single-instance deployments.
 * For multi-instance deployments, consider using Redis or a similar distributed store.
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// Store rate limit data by IP address
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up old entries periodically
const CLEANUP_INTERVAL_MS = 60000; // 1 minute
let cleanupScheduled = false;

function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;

  setTimeout(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
    cleanupScheduled = false;
  }, CLEANUP_INTERVAL_MS);
}

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Time window in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  /** Whether the request should be allowed */
  allowed: boolean;
  /** Number of requests remaining in the current window */
  remaining: number;
  /** Unix timestamp (ms) when the window resets */
  resetTime: number;
  /** Total limit for the window */
  limit: number;
}

/**
 * Check if a request should be rate limited.
 *
 * @param identifier - Unique identifier for the client (usually IP address)
 * @param config - Rate limit configuration
 * @returns Rate limit result with allowed status and metadata
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const key = identifier;

  let entry = rateLimitStore.get(key);

  // If no entry or window has expired, create a new one
  if (!entry || entry.resetTime < now) {
    entry = {
      count: 1,
      resetTime: now + config.windowMs,
    };
    rateLimitStore.set(key, entry);
    scheduleCleanup();

    return {
      allowed: true,
      remaining: config.limit - 1,
      resetTime: entry.resetTime,
      limit: config.limit,
    };
  }

  // Increment count
  entry.count++;

  // Check if over limit
  const allowed = entry.count <= config.limit;
  const remaining = Math.max(0, config.limit - entry.count);

  return {
    allowed,
    remaining,
    resetTime: entry.resetTime,
    limit: config.limit,
  };
}

/**
 * Get the client IP address from the request.
 * Prefers trusted single-value headers set by reverse proxies over
 * the multi-value X-Forwarded-For which is easier to spoof.
 */
export function getClientIp(request: Request): string {
  // Cloudflare sets this to the real client IP — single value, not spoofable
  // when traffic goes through Cloudflare.
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp.trim();
  }

  // Nginx/other proxies set this to the real client IP
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  // Fallback to X-Forwarded-For — take the first IP (original client).
  // When behind a trusted proxy like Cloudflare/nginx, the proxy overwrites
  // this header, so the first entry is the real client IP.
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  return 'unknown';
}

/**
 * Create rate limit headers for the response.
 */
export function createRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(result.resetTime / 1000).toString(),
  };
}

// Default rate limit configs for different endpoint types
export const RATE_LIMITS = {
  /** Standard API endpoints: 100 requests per minute */
  standard: { limit: 100, windowMs: 60000 },
  /** Auth endpoints: 10 requests per minute (stricter for brute force protection) */
  auth: { limit: 10, windowMs: 60000 },
  /** Image proxy: 500 outbound fetches per minute (cache hits bypass rate limiting) */
  imageProxy: { limit: 500, windowMs: 60000 },
  /** Heavy operations: 20 requests per minute */
  heavy: { limit: 20, windowMs: 60000 },
  /** External proxy: 30 requests per minute (protects upstream APIs from abuse) */
  externalProxy: { limit: 30, windowMs: 60000 },
} as const;
