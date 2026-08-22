import { getBackendUrlOptional } from '@/lib/config';

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

/**
 * One title from the local reading-difficulty mirror.
 *
 * Shaped like the deck-derived objects the similar-titles panels render, so the mirror and
 * the upstream are interchangeable to everything downstream of here.
 */
export interface DifficultyVN {
  vnId: string;
  title: string;
  titleJp: string;
  difficulty: number;
  characterCount: number;
  coverUrl: string | null;
  imageSexual: number;
}

interface DifficultyQuery {
  min_difficulty?: number;
  max_difficulty?: number;
  near_difficulty?: number;
  near_characters?: number;
  exclude?: string;
  limit?: number;
}

/**
 * Titles from the difficulty mirror, ordered by whichever closeness the query asks for.
 *
 * The backend returns the cover alongside the measurements, so no second pass is needed to
 * fill them in.
 */
export async function fetchByDifficulty(query: DifficultyQuery): Promise<DifficultyVN[]> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return [];

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }

  const res = await fetch(`${backendUrl}/api/v1/vn/difficulty/?${params}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`difficulty lookup failed: ${res.status}`);

  const body = await res.json();
  return (body.results ?? []).map((row: Record<string, never>): DifficultyVN => ({
    vnId: row.id,
    // Latin form first, matching how these panels label a card.
    title: row.title_romaji || row.title,
    titleJp: row.title_jp || row.title,
    difficulty: row.difficulty,
    characterCount: row.character_count,
    coverUrl: row.image_url ?? null,
    imageSexual: row.image_sexual ?? 0,
  }));
}

export interface CoverInfo {
  url: string;
  sexual: number;
}

const FETCH_COVERS_CONCURRENCY = 5;

/** Batch-fetch cover URLs and sexual ratings from our local backend. */
export async function fetchCovers(vnIds: string[]): Promise<Map<string, CoverInfo>> {
  if (vnIds.length === 0) return new Map();
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return new Map();
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
