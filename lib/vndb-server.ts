/**
 * Server-side VNDB data fetching for metadata generation and SSR.
 * Uses Next.js fetch caching for performance.
 */

import { VNDetail, VNCharacter, SimilarVNsResponse, BrowseResponse, BrowseFilters } from './vndb-stats-api';
import { getBackendUrlOptional } from './config';

// Default items per page (matches medium grid size: 5 cols × 7 rows at xl)
const DEFAULT_LIMIT = 35;

/**
 * Parse URL search params into BrowseFilters for server-side fetching.
 */
function parseSearchParams(
  searchParams: { [key: string]: string | string[] | undefined }
): BrowseFilters {
  const getString = (key: string): string | undefined => {
    const val = searchParams[key];
    return typeof val === 'string' ? val : undefined;
  };

  const getNumber = (key: string): number | undefined => {
    const val = getString(key);
    return val ? Number(val) : undefined;
  };

  return {
    q: getString('q'),
    first_char: getString('first_char'),
    tags: getString('tags'),
    exclude_tags: getString('exclude_tags'),
    traits: getString('traits'),
    exclude_traits: getString('exclude_traits'),
    tag_mode: (getString('tag_mode') as 'and' | 'or') || 'and',
    include_children: searchParams.include_children !== undefined
      ? getString('include_children') === 'true'
      : true, // Default to true
    spoiler_level: getNumber('spoiler_level') ?? 0,
    year_min: getNumber('year_min'),
    year_max: getNumber('year_max'),
    min_rating: getNumber('min_rating'),
    max_rating: getNumber('max_rating'),
    min_votecount: getNumber('min_votecount'),
    max_votecount: getNumber('max_votecount'),
    length: getString('length'),
    exclude_length: getString('exclude_length'),
    minage: getString('minage'),
    exclude_minage: getString('exclude_minage'),
    devstatus: getString('devstatus') || '-1', // Default: all statuses
    exclude_devstatus: getString('exclude_devstatus'),
    // olang: empty string = all languages, absent = default to Japanese
    olang: searchParams.olang !== undefined
      ? (getString('olang') || undefined)
      : 'ja',
    exclude_olang: getString('exclude_olang'),
    platform: getString('platform'),
    exclude_platform: getString('exclude_platform'),
    staff: getString('staff'),
    seiyuu: getString('seiyuu'),
    developer: getString('developer'),
    publisher: getString('publisher'),
    producer: getString('producer'),
    sort: (getString('sort') as BrowseFilters['sort']) || 'rating',
    sort_order: (getString('sort_order') as 'asc' | 'desc') || 'desc',
    page: getNumber('page') || 1,
    limit: Math.min(getNumber('limit') || DEFAULT_LIMIT, 100),
  };
}

/**
 * Fetch browse results server-side for SSR.
 * Uses Next.js caching with 1-minute revalidation for fresh but fast responses.
 */
export async function browseVNsServer(
  searchParams: { [key: string]: string | string[] | undefined }
): Promise<BrowseResponse | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  const filters = parseSearchParams(searchParams);

  // Build query string
  const params = new URLSearchParams();

  // Add all non-undefined filters
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  });

  // Always include NSFW content (filtered client-side with blur)
  params.set('nsfw', 'true');

  try {
    const res = await fetch(`${backendUrl}/api/v1/vn/search/?${params.toString()}`, {
      next: { revalidate: 300 }, // Cache for 5 minutes (data changes daily via VNDB dumps)
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch VN data server-side for metadata generation.
 * Uses Next.js caching with 1-hour revalidation.
 */
export async function getVNForMetadata(vnId: string): Promise<VNDetail | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  // Normalize VN ID to include 'v' prefix if missing
  const normalizedId = vnId.startsWith('v') ? vnId : `v${vnId}`;

  try {
    const res = await fetch(`${backendUrl}/api/v1/vn/${normalizedId}`, {
      next: { revalidate: 3600 }, // Cache for 1 hour
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch producer data server-side for metadata generation.
 */
export async function getProducerForMetadata(
  producerId: string
): Promise<{ name: string; original?: string; description?: string } | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  try {
    const res = await fetch(`${backendUrl}/api/v1/stats/producer/${producerId}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.producer || null;
  } catch {
    return null;
  }
}

/**
 * Fetch tag data server-side for metadata generation.
 */
export async function getTagForMetadata(
  tagId: string
): Promise<{ name: string; description?: string } | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  try {
    const res = await fetch(`${backendUrl}/api/v1/stats/tag/${tagId}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.tag || null;
  } catch {
    return null;
  }
}

/**
 * Fetch trait data server-side for metadata generation.
 */
export async function getTraitForMetadata(
  traitId: string
): Promise<{ name: string; description?: string } | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  try {
    const res = await fetch(`${backendUrl}/api/v1/stats/trait/${traitId}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.trait || null;
  } catch {
    return null;
  }
}

/**
 * Fetch staff data server-side for metadata generation.
 * Pass type='seiyuu' for voice actor pages.
 */
export async function getStaffForMetadata(
  staffId: string,
  type: 'staff' | 'seiyuu' = 'staff'
): Promise<{ name: string; original?: string; description?: string } | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  try {
    const res = await fetch(`${backendUrl}/api/v1/stats/${type}/${staffId}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.staff || null;
  } catch {
    return null;
  }
}

/**
 * Fetch character data server-side for metadata generation.
 */
export async function getCharacterForMetadata(
  charId: string
): Promise<{ name: string; original?: string; description?: string; image_url?: string; image_sexual?: number } | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  const normalizedId = charId.startsWith('c') ? charId : `c${charId}`;

  try {
    const res = await fetch(`${backendUrl}/api/v1/characters/${normalizedId}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return {
      name: data.name,
      original: data.original,
      description: data.description,
      image_url: data.image_url,
      image_sexual: data.image_sexual,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch VN characters server-side.
 * Returns null on failure (characters are optional).
 */
export async function getVNCharactersServer(vnId: string): Promise<VNCharacter[] | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  const normalizedId = vnId.startsWith('v') ? vnId : `v${vnId}`;

  try {
    const res = await fetch(`${backendUrl}/api/v1/vn/${normalizedId}/characters`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch similar VNs server-side.
 */
export async function getSimilarVNsServer(vnId: string, limit: number = 10): Promise<SimilarVNsResponse | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  const normalizedId = vnId.startsWith('v') ? vnId : `v${vnId}`;

  try {
    const res = await fetch(`${backendUrl}/api/v1/vn/${normalizedId}/similar?limit=${limit}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

