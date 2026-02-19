const deckIdCache = new Map<string, { id: number | null; ts: number }>();
const DECK_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/** Resolve a VNDB ID (e.g. "v17") to a jiten.moe deck ID. */
export async function resolveDeckId(vnId: string, signal?: AbortSignal): Promise<number | null> {
  const cached = deckIdCache.get(vnId);
  if (cached && Date.now() - cached.ts < DECK_CACHE_TTL) {
    return cached.id;
  }

  const res = await fetch(
    `https://api.jiten.moe/api/media-deck/by-link-id/2/${vnId}`,
    { signal }
  );
  if (res.status >= 500) throw new Error(`Jiten API error: ${res.status}`);
  if (!res.ok) return null; // 4xx = no deck found for this VN
  const ids: number[] = await res.json();
  const id = ids.length > 0 ? ids[0] : null;

  deckIdCache.set(vnId, { id, ts: Date.now() });

  // Evict old entries if cache grows too large
  if (deckIdCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of deckIdCache) {
      if (now - v.ts > DECK_CACHE_TTL) deckIdCache.delete(k);
    }
  }

  return id;
}
