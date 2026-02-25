/**
 * VNDB Image Cache Pre-population Script
 *
 * ============================================================================
 * IMPORTANT: ALL VNDB DATA COMES FROM LOCAL DATABASE DUMPS
 * ============================================================================
 * This script queries the backend (local PostgreSQL with VNDB dumps) to get
 * VN data including image URLs, then downloads and caches the images.
 *
 * DO NOT call the VNDB API directly for data - all data is in the local database.
 * The only external requests this script makes are to t.vndb.org for actual
 * image file downloads (which is unavoidable - we're caching image files).
 * ============================================================================
 *
 * Automatically run before production builds to pre-cache VNDB images.
 * Images will be saved to .cache/vndb/ and served via the /img/ API route.
 * Converts images to WebP for smaller file sizes.
 *
 * Usage: npx tsx scripts/cache-vndb-images.ts [--top N] [--vn-ids v1,v2,...] [--skip]
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

// Cache dir priority: VNDB_CACHE_DIR env > static export public/ > ~/.vnclub/vndb-cache
function resolveCacheDir(): string {
  if (process.env.VNDB_CACHE_DIR) return path.resolve(process.env.VNDB_CACHE_DIR);
  if (process.env.STATIC_EXPORT === 'true') return path.join(process.cwd(), 'public/cache/vndb');
  return path.join(os.homedir(), '.vnclub', 'vndb-cache');
}
const CACHE_DIR = resolveCacheDir();
// Backend URL - uses local database dumps, NOT VNDB API
const BACKEND_URL = process.env.NEXT_PUBLIC_VNDB_STATS_API || 'http://localhost:8000';
const CONCURRENT_DOWNLOADS = 5; // parallel image downloads
const WEBP_QUALITY = 80; // WebP quality (0-100)

interface BackendVNResponse {
  vns: Array<{
    id: string;
    title: string;
    image_url?: string;
  }>;
  total: number;
  page: number;
  pages: number;
}

/**
 * Ensure directory exists
 */
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Extract cache path from VNDB image URL
 */
function getCachePathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 't.vndb.org') return null;
    return parsed.pathname.slice(1); // Remove leading slash
  } catch {
    return null;
  }
}

/**
 * Download and cache a single image
 * Converts to WebP for smaller file sizes
 * Returns: true = newly cached, 'skipped' = already cached, false = failed
 */
async function cacheImage(imageUrl: string): Promise<boolean | 'skipped'> {
  const cachePath = getCachePathFromUrl(imageUrl);
  if (!cachePath) {
    return false;
  }

  const fullPath = path.join(CACHE_DIR, cachePath);
  const webpPath = fullPath.replace(/\.(jpg|jpeg|png)$/i, '.webp');

  // Check if WebP version already cached
  if (fs.existsSync(webpPath)) {
    return 'skipped'; // Already cached
  }

  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'VN-Club-Resources/1.0 (image caching)',
      },
    });

    if (!response.ok) {
      return false;
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return false;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Ensure directory exists
    ensureDir(path.dirname(fullPath));

    // Convert to WebP and save
    await sharp(buffer)
      .webp({ quality: WEBP_QUALITY })
      .toFile(webpPath);

    // Also save original as fallback
    fs.writeFileSync(fullPath, buffer);

    return true;
  } catch {
    return false;
  }
}

/**
 * Process images in parallel with concurrency limit
 */
async function processImagesInParallel(
  images: Array<{ id: string; title: string; url: string }>
): Promise<{ cached: number; skipped: number; failed: number }> {
  const results = { cached: 0, skipped: 0, failed: 0 };
  const queue = [...images];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const result = await cacheImage(item.url);
      if (result === true) {
        results.cached++;
      } else if (result === 'skipped') {
        results.skipped++;
      } else {
        results.failed++;
      }
    }
  }

  // Start concurrent workers
  const workers = Array(CONCURRENT_DOWNLOADS).fill(null).map(() => worker());
  await Promise.all(workers);

  return results;
}

/**
 * Fetch top VNs from local database (via backend API)
 * ALL data comes from VNDB database dumps - NO direct VNDB API calls.
 */
async function fetchTopVNs(count: number): Promise<string[]> {
  console.log(`Fetching top ${count} VNs from local database...`);

  const vnIds: string[] = [];
  const imagesToCache: Array<{ id: string; title: string; url: string }> = [];
  let page = 1;
  const pageSize = Math.min(count, 100);

  try {
    while (vnIds.length < count) {
      // Use backend browse endpoint which queries local PostgreSQL
      const url = `${BACKEND_URL}/api/v1/browse/vns?sort=rating&sort_order=desc&limit=${pageSize}&page=${page}`;
      console.log(`  Fetching page ${page}...`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`Backend API error: ${response.status}`);
        console.error('Make sure the backend server is running (vndb-stats-backend)');
        break;
      }

      const data: BackendVNResponse = await response.json();

      for (const vn of data.vns) {
        vnIds.push(vn.id);
        if (vn.image_url) {
          imagesToCache.push({ id: vn.id, title: vn.title, url: vn.image_url });
        }
      }

      if (page >= data.pages || vnIds.length >= count) break;
      page++;
    }
  } catch (error) {
    console.error('Error fetching from backend:', error);
    console.error('Make sure the backend server is running at:', BACKEND_URL);
    return [];
  }

  console.log(`Found ${imagesToCache.length} images to cache`);

  if (imagesToCache.length > 0) {
    console.log('Downloading images from t.vndb.org...');
    const results = await processImagesInParallel(imagesToCache);
    console.log(`  Cached: ${results.cached}, Skipped (already cached): ${results.skipped}, Failed: ${results.failed}`);
  }

  return vnIds;
}

/**
 * Fetch specific VNs by ID from local database (via backend API)
 * ALL data comes from VNDB database dumps - NO direct VNDB API calls.
 */
async function fetchVNsByIds(ids: string[]): Promise<void> {
  console.log(`Fetching ${ids.length} VNs by ID from local database...`);

  try {
    for (const id of ids) {
      // Normalize ID
      const normalizedId = id.startsWith('v') ? id : `v${id}`;

      const response = await fetch(`${BACKEND_URL}/api/v1/vn/${normalizedId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.log(`  Not found or error: ${normalizedId}`);
        continue;
      }

      const vn = await response.json();

      if (vn.image_url) {
        console.log(`  Found: ${vn.id} - ${vn.title}`);
        const cached = await cacheImage(vn.image_url);
        if (cached) {
          console.log(`    Cached: ${vn.image_url}`);
        }
      }
    }
  } catch (error) {
    console.error('Error fetching from backend:', error);
    console.error('Make sure the backend server is running at:', BACKEND_URL);
  }
}

// Note: chunkArray and sleep functions removed - no longer needed since
// we're querying local database instead of VNDB API with rate limits

/**
 * Parse command line arguments
 */
function parseArgs(): { top?: number; vnIds?: string[]; skip?: boolean } {
  const args = process.argv.slice(2);
  const result: { top?: number; vnIds?: string[]; skip?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--top' && args[i + 1]) {
      result.top = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--vn-ids' && args[i + 1]) {
      result.vnIds = args[i + 1].split(',').map((s) => s.trim());
      i++;
    } else if (args[i] === '--skip') {
      result.skip = true;
    }
  }

  return result;
}

/**
 * Main function
 */
async function main() {
  const args = parseArgs();

  // Allow skipping cache population (useful for dev builds)
  if (args.skip) {
    console.log('Skipping VNDB image cache pre-population (--skip flag)');
    return;
  }

  console.log('VNDB Image Cache Pre-population');
  console.log('================================\n');

  // Ensure cache directory exists
  ensureDir(CACHE_DIR);

  // Quick backend connectivity check — if unreachable, skip gracefully.
  // This is expected during Docker builds where the backend isn't running yet.
  // Images will be cached on-demand at runtime via the /img/ route.
  try {
    const healthCheck = await fetch(`${BACKEND_URL}/api/v1/browse/vns?limit=1&page=1`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!healthCheck.ok) {
      console.log(`Backend not available (HTTP ${healthCheck.status}) — skipping image pre-cache.`);
      console.log('Images will be cached on-demand at runtime.\n');
      return;
    }
  } catch {
    console.log('Backend not reachable — skipping image pre-cache.');
    console.log('Images will be cached on-demand at runtime.\n');
    return;
  }

  // Default: fetch top 100 VNs (covers most commonly viewed)
  const topCount = args.top ?? 100;

  if (args.vnIds && args.vnIds.length > 0) {
    // Fetch specific VNs
    await fetchVNsByIds(args.vnIds);
  } else {
    // Fetch top VNs by rating
    await fetchTopVNs(topCount);
  }

  console.log('\nCache pre-population complete!');
  console.log(`Cache directory: ${CACHE_DIR}`);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
