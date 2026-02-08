/**
 * Server-side fetching for featured VNs on the home page.
 * Uses Next.js ISR for automatic revalidation.
 */

import { getBackendUrlOptional } from './config';
import { getProxiedImageUrl } from './vndb-image-cache';

export interface FeaturedVNData {
  id: string;
  title?: string;
  title_jp?: string;
  title_romaji?: string;
  imageUrl: string | null;
}

// Recommended First VNs from /guide page
const FEATURED_VN_IDS = [
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
 * Fetch all featured VN data server-side with ISR caching.
 * Returns all VNs so client can shuffle for variety.
 */
export async function getFeaturedVNsData(): Promise<FeaturedVNData[]> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) {
    return [];
  }

  try {
    const vnPromises = FEATURED_VN_IDS.map(
      async (id): Promise<FeaturedVNData | null> => {
        try {
          const res = await fetch(`${backendUrl}/api/v1/vn/${id}`, {
            next: { revalidate: 3600 }, // ISR: revalidate every hour
            signal: AbortSignal.timeout(10000),
          });

          if (!res.ok) return null;

          const data = await res.json();
          return {
            id,
            title: data.title,
            title_jp: data.title_jp,
            title_romaji: data.title_romaji,
            imageUrl: data.image_url ? getProxiedImageUrl(data.image_url) : null,
          };
        } catch {
          return null;
        }
      }
    );

    const results = await Promise.all(vnPromises);
    return results.filter((vn): vn is FeaturedVNData => vn !== null);
  } catch {
    return [];
  }
}
