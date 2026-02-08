/**
 * Cover blacklist cache for checking if VN covers should be blocked.
 *
 * This module maintains an in-memory cache of blacklisted VN IDs that is
 * refreshed periodically. The cache is used by the image proxy route to
 * determine whether to serve a placeholder instead of the actual cover.
 */

import { getBackendUrlOptional } from './config';

// Cache configuration - 1 minute TTL for faster updates after rule changes
const CACHE_TTL_MS = 60 * 1000; // 1 minute

// In-memory cache
let blacklistSet: Set<string> | null = null;
let lastFetchTime = 0;
let fetchPromise: Promise<void> | null = null;

interface BlacklistIdsResponse {
  vnIds: string[];
  updatedAt: string;
}

/**
 * Refresh the blacklist cache from the backend API.
 */
async function refreshBlacklist(): Promise<void> {
  const backendUrl = getBackendUrlOptional();

  if (!backendUrl) {
    // No backend configured, use empty blacklist
    blacklistSet = new Set();
    lastFetchTime = Date.now();
    return;
  }

  try {
    const response = await fetch(`${backendUrl}/api/v1/blacklist/ids`, {
      next: { revalidate: 60 }, // Cache for 1 minute in Next.js
      signal: AbortSignal.timeout(5000), // 5s timeout to avoid blocking image requests
    });

    if (!response.ok) {
      console.error(`[blacklist-cache] Failed to fetch blacklist: ${response.status}`);
      // Keep using stale cache if available
      if (!blacklistSet) {
        blacklistSet = new Set();
      }
      return;
    }

    const data: BlacklistIdsResponse = await response.json();
    blacklistSet = new Set(data.vnIds);
    lastFetchTime = Date.now();
  } catch (error) {
    console.error('[blacklist-cache] Error fetching blacklist:', error);
    // Keep using stale cache if available
    if (!blacklistSet) {
      blacklistSet = new Set();
    }
  }
}

/**
 * Ensure the blacklist cache is fresh, refreshing if needed.
 */
async function ensureFreshCache(): Promise<void> {
  const now = Date.now();
  const isStale = !blacklistSet || now - lastFetchTime > CACHE_TTL_MS;

  if (isStale) {
    // Prevent concurrent refresh requests
    if (!fetchPromise) {
      fetchPromise = refreshBlacklist().finally(() => {
        fetchPromise = null;
      });
    }
    await fetchPromise;
  }
}

/**
 * Check if a VN's cover is blacklisted.
 *
 * @param vnId The VN ID (e.g., "v123" or "123")
 * @returns true if the cover is blacklisted
 */
export async function isVnBlacklisted(vnId: string): Promise<boolean> {
  await ensureFreshCache();

  // Normalize the VN ID (ensure it has "v" prefix)
  const normalizedId = vnId.startsWith('v') ? vnId : `v${vnId}`;

  return blacklistSet?.has(normalizedId) ?? false;
}

/**
 * Get all blacklisted VN IDs.
 * Useful for bulk checks or debugging.
 */
export async function getBlacklistedIds(): Promise<string[]> {
  await ensureFreshCache();
  return Array.from(blacklistSet ?? []);
}

/**
 * Force refresh the blacklist cache.
 * Useful after admin makes changes.
 */
export async function forceRefreshBlacklist(): Promise<void> {
  lastFetchTime = 0; // Mark as stale
  await ensureFreshCache();
}

/**
 * Extract VN ID from a cover image path.
 *
 * Cover paths are in format: cv/{subdir}/{id}.jpg
 * The id is the numeric part of the VN ID.
 *
 * @param pathSegments The path segments from the image route
 * @returns The VN ID (e.g., "v12345") or null if not a cover
 */
export function extractVnIdFromCoverPath(pathSegments: string[]): string | null {
  if (pathSegments.length !== 3) {
    return null;
  }

  const [prefix, , filename] = pathSegments;

  // Only process cover images
  if (prefix !== 'cv') {
    return null;
  }

  // Extract numeric ID from filename (e.g., "12345.jpg" -> "12345")
  const match = filename.match(/^(\d+)\.(jpg|webp)$/);
  if (!match) {
    return null;
  }

  return `v${match[1]}`;
}
