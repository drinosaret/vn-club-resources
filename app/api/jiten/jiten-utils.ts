import { getBackendUrl } from '@/lib/config';

export interface JitenMediaDeck {
  deckId: number;
  originalTitle: string;
  romajiTitle: string | null;
  englishTitle: string | null;
  characterCount: number;
  difficultyRaw: number;
  coverName: string | null;
  links: Array<{ linkType: number; url: string }>;
}

/** Extract VNDB ID from a jiten.moe media deck's links. */
export function extractVnId(deck: JitenMediaDeck): string | null {
  const vndbLink = deck.links?.find((l) => l.linkType === 2);
  if (!vndbLink?.url) return null;
  const match = vndbLink.url.match(/vndb\.org\/(v\d+)/);
  return match ? match[1] : null;
}

export interface CoverInfo {
  url: string;
  sexual: number;
}

const FETCH_COVERS_CONCURRENCY = 5;

/** Batch-fetch cover URLs and sexual ratings from our local backend. */
export async function fetchCovers(vnIds: string[]): Promise<Map<string, CoverInfo>> {
  if (vnIds.length === 0) return new Map();
  const backendUrl = getBackendUrl();
  const map = new Map<string, CoverInfo>();

  // Process in chunks to avoid overwhelming the backend
  for (let i = 0; i < vnIds.length; i += FETCH_COVERS_CONCURRENCY) {
    const chunk = vnIds.slice(i, i + FETCH_COVERS_CONCURRENCY);
    await Promise.allSettled(
      chunk.map(async (id) => {
        const res = await fetch(`${backendUrl}/api/v1/vn/${id}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.image_url) {
          map.set(id, { url: data.image_url, sexual: data.image_sexual ?? 0 });
        }
      })
    );
  }
  return map;
}
