/**
 * Application configuration utilities.
 *
 * Centralizes environment variable access and provides fail-fast behavior
 * when required configuration is missing.
 */

/**
 * Get the backend API URL.
 *
 * @throws Error if NEXT_PUBLIC_VNDB_STATS_API is not set
 */
export function getBackendUrl(): string {
  const url = process.env.NEXT_PUBLIC_VNDB_STATS_API;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_VNDB_STATS_API environment variable is required. ' +
        'Set it in .env.local or your deployment environment.'
    );
  }
  return url;
}

/**
 * Get the backend API URL, returning undefined if not set.
 * Use this only for optional features that can work without the backend.
 */
export function getBackendUrlOptional(): string | undefined {
  return process.env.NEXT_PUBLIC_VNDB_STATS_API;
}

/**
 * Check if backend API is configured.
 */
export function isBackendConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_VNDB_STATS_API;
}
