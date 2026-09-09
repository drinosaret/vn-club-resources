import crypto from 'crypto';

/**
 * Whether a request carries the secret the backend uses to ask this site to refresh a cache.
 *
 * A header value's character count is not its byte count, and a comparison of raw bytes
 * rejects a pair of unequal length rather than answering. Comparing digests instead leaves
 * two fixed-width values whatever arrived, and the comparison stays constant time.
 *
 * With no secret configured nothing is accepted: 'unconfigured' names that case so a route can
 * answer it differently from a wrong token.
 */
export function verifyRefreshToken(request: Request): 'ok' | 'unauthorized' | 'unconfigured' {
  const expectedSecret = process.env.BLACKLIST_REFRESH_SECRET;
  if (!expectedSecret) return 'unconfigured';
  const provided = crypto.createHash('sha256').update(request.headers.get('x-refresh-token') ?? '', 'utf8').digest();
  const expected = crypto.createHash('sha256').update(expectedSecret, 'utf8').digest();
  return crypto.timingSafeEqual(provided, expected) ? 'ok' : 'unauthorized';
}
