/**
 * Server-side fetching for featured VNs on the home page.
 * Uses Next.js ISR for automatic revalidation.
 */

import { unstable_cache } from 'next/cache';

import { getBackendUrlOptional } from './config';

export interface FeaturedVNData {
  id: string;
  title?: string;
  title_jp?: string;
  title_romaji?: string;
  imageUrl: string | null;
  image_sexual?: number;
}

/** The subset of a VN record the batch endpoint answers with. */
interface BatchItemBrief {
  id: string;
  title: string;
  title_jp?: string | null;
  title_romaji?: string | null;
  image_url?: string | null;
  image_sexual?: number | null;
}

const REVALIDATE_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 10000;

// Recommended First VNs from /guide page
export const FEATURED_VN_IDS = [
  'v15473', // Nanairo Reincarnation
  'v31212', // Tsuyuchiru Letter
  'v711', // Gyakuten Saiban (Ace Attorney)
  'v26902', // Marco to Ginga Ryuu
  'v19829', // 9-nine- Series
  'v7738', // Totono
  'v3433', // Famicom Detective Club
  'v20424', // Summer Pockets
  'v4', // Clannad
  'v33', // Kanon
  'v12849', // Aokana
];

/**
 * One request for the whole list, holding the cover fields the shelf reads.
 *
 * The batch endpoint answers in database order and omits an id it holds no row for, so the
 * list order is reimposed here: callers take the leading few and depend on the order.
 *
 * A transport or server failure throws rather than resolving empty, so that the hour-long
 * cache below never stores the outcome of a backend that was briefly unreachable. A POST is
 * outside the fetch data cache, which is why the caching is explicit.
 */
const loadFeaturedVNs = unstable_cache(
  async (backendUrl: string): Promise<FeaturedVNData[]> => {
    const res = await fetch(`${backendUrl}/api/v1/vn/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: FEATURED_VN_IDS }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Featured VN batch responded ${res.status}`);
    }

    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) {
      throw new Error('Featured VN batch returned an unexpected shape');
    }

    const byId = new Map<string, BatchItemBrief>();
    for (const row of rows as BatchItemBrief[]) {
      if (row && typeof row.id === 'string') byId.set(row.id, row);
    }

    return FEATURED_VN_IDS.reduce<FeaturedVNData[]>((acc, id) => {
      const row = byId.get(id);
      if (row) {
        acc.push({
          id,
          title: row.title,
          title_jp: row.title_jp ?? undefined,
          title_romaji: row.title_romaji ?? undefined,
          imageUrl: row.image_url || null,
          image_sexual: row.image_sexual ?? 0,
        });
      }
      return acc;
    }, []);
  },
  ['featured-vns-batch'],
  { revalidate: REVALIDATE_SECONDS, tags: ['featured-vns'] }
);

/**
 * Featured VN data for the shelf, in the order `FEATURED_VN_IDS` declares.
 * An unreachable backend yields an empty shelf rather than failing the page.
 */
export async function getFeaturedVNsData(): Promise<FeaturedVNData[]> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) {
    return [];
  }

  try {
    return await loadFeaturedVNs(backendUrl);
  } catch {
    return [];
  }
}
