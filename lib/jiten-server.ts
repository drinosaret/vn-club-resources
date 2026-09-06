import { resolveDeckId } from '@/app/api/jiten/resolve-deck';
import type { LanguageDeckStats } from './reading-style';

/**
 * Language measurements fetched during the server render of a title page.
 *
 * This reads the same upstream endpoint the language tab reads on the client; it exists so
 * the prose summary reaches the delivered HTML rather than appearing only after hydration.
 * Nothing else on the page depends on it, so every failure resolves to a null rather than
 * propagating.
 */
export type LanguageLookup =
  /** The upstream has no deck for this title, so it is genuinely unmeasured. */
  | { deckId: null; stats: null }
  | { deckId: number; stats: LanguageDeckStats };

interface JitenDetailBody {
  data?: {
    parentDeck?: LanguageDeckStats | null;
    mainDeck?: LanguageDeckStats | null;
  } | null;
  parentDeck?: LanguageDeckStats | null;
  mainDeck?: LanguageDeckStats | null;
}

const UPSTREAM_TIMEOUT_MS = 5000;

// Measurements are recomputed rarely, so a hit is held far longer than a page revalidation.
// A miss is held for less because a title gains a deck without warning.
const HIT_TTL = 6 * 60 * 60 * 1000;
const MISS_TTL = 30 * 60 * 1000;
const CACHE_MAX = 1000;

const cache = new Map<string, { value: LanguageLookup; ts: number }>();

function ttlFor(value: LanguageLookup): number {
  return value.stats ? HIT_TTL : MISS_TTL;
}

function cacheGet(vnId: string): LanguageLookup | null {
  const hit = cache.get(vnId);
  if (!hit) return null;
  if (Date.now() - hit.ts >= ttlFor(hit.value)) {
    cache.delete(vnId);
    return null;
  }
  return hit.value;
}

function cacheSet(vnId: string, value: LanguageLookup): void {
  const now = Date.now();
  if (cache.size >= CACHE_MAX) {
    for (const [key, entry] of cache) {
      if (now - entry.ts >= ttlFor(entry.value)) cache.delete(key);
    }
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  }
  cache.set(vnId, { value, ts: now });
}

/** The measurements carried by whichever deck describes the title as a whole. */
function pickDeck(body: JitenDetailBody | null): LanguageDeckStats | null {
  const decks = body?.data ?? body;
  return decks?.mainDeck ?? decks?.parentDeck ?? null;
}

/**
 * Resolve a VNDB id to its language measurements, or null when the lookup itself failed.
 *
 * A null return means "unknown", which leaves the client free to try again; a resolved
 * object with a null `stats` means the upstream has nothing for this title and the page
 * must say so.
 */
export async function fetchLanguageLookup(vnId: string): Promise<LanguageLookup | null> {
  const cached = cacheGet(vnId);
  if (cached) return cached;

  // The two hops are sequential, so one deadline covers the pair. A budget per hop would let
  // a slow upstream hold the server render for twice as long as the page is willing to wait.
  const deadline = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);

  let deckId: number | null;
  try {
    deckId = await resolveDeckId(vnId, deadline);
  } catch {
    return null;
  }

  if (deckId === null) {
    const value: LanguageLookup = { deckId: null, stats: null };
    cacheSet(vnId, value);
    return value;
  }

  let stats: LanguageDeckStats | null = null;
  try {
    // This pair of hops is the largest single cost of a cold title render, and the map above
    // holds far fewer entries than the site has titles, so a shared cache carries the result
    // between renders that the map has already evicted.
    const res = await fetch(`https://api.jiten.moe/api/media-deck/${deckId}/detail`, {
      signal: deadline,
      next: { revalidate: HIT_TTL / 1000 },
    });
    if (res.ok) stats = pickDeck((await res.json()) as JitenDetailBody);
  } catch {
    stats = null;
  }

  // A deck that exists but whose detail could not be read is unknown, not unmeasured. Leaving
  // it uncached and unresolved keeps the client free to fill the gap in.
  if (!stats) return null;

  const value: LanguageLookup = { deckId, stats };
  cacheSet(vnId, value);
  return value;
}
