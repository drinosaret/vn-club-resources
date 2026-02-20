const deckIdCache = new Map<string, { id: number | null; ts: number }>();
const DECK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours — deck ID mappings essentially never change
const NULL_CACHE_TTL = 60 * 60 * 1000;       // 1 hour — recheck "not on jiten" results sooner

/** Resolve a VNDB ID (e.g. "v17") to a jiten.moe deck ID. */
export async function resolveDeckId(vnId: string, signal?: AbortSignal): Promise<number | null> {
  const cached = deckIdCache.get(vnId);
  if (cached) {
    const ttl = cached.id !== null ? DECK_CACHE_TTL : NULL_CACHE_TTL;
    if (Date.now() - cached.ts < ttl) return cached.id;
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
  if (deckIdCache.size > 5000) {
    const now = Date.now();
    for (const [k, v] of deckIdCache) {
      const ttl = v.id !== null ? DECK_CACHE_TTL : NULL_CACHE_TTL;
      if (now - v.ts > ttl) deckIdCache.delete(k);
    }
  }

  return id;
}
