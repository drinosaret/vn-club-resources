/**
 * The releases page's record of what has come out, grouped by the day it came out on.
 *
 * The catalogue's own rows and the storefront listings are merged, so a title that reached
 * both reads as one entry with the store's price on it. Only a date stated to the day is
 * placed: a row that names a month has no line to sit on.
 */

import {
  STORE_PLATE,
  numberOrNull,
  safeExternalUrl,
  shiftDay,
  stringArray,
  stringOrNull,
  vnPath,
  type NewsItem,
} from './news';

/** How far back the list runs, matching the window the endpoint fills. */
export const OUT_NOW_DAYS = 30;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** One title on one day, whichever source placed it there. */
export interface OutNowEntry {
  key: string;
  date: string;
  vnId: string | null;
  title: string;
  titleJp: string | null;
  titleRomaji: string | null;
  /** Studio names in the romanised list and, beside it, the list in the original script. */
  developers: string[];
  developersOriginal: string[];
  platforms: string[];
  minage: number | null;
  price: string | null;
  originalPrice: string | null;
  discount: number | null;
  /** The store's plate, or null for a row the catalogue alone knows. */
  store: string | null;
  href: string | null;
  external: boolean;
  imageUrl: string | null;
  imageSexual: number;
  rating: number | null;
  votecount: number | null;
}

export interface OutNowDay {
  date: string;
  entries: OutNowEntry[];
}

function toEntry(item: NewsItem): OutNowEntry | null {
  const extra = item.extraData ?? {};
  const date = stringOrNull(extra.released);
  if (!date || !DAY.test(date)) return null;

  const developers = stringArray(extra.developers);
  // A store row that credits nobody still names the brand behind the listing.
  const brand = stringOrNull(extra.maker) ?? stringOrNull(extra.brand);
  const internal = vnPath(item.vnId);
  const external = safeExternalUrl(item.url) ?? null;

  return {
    key: item.id,
    date,
    vnId: item.vnId ?? null,
    title: item.title,
    titleJp: stringOrNull(extra.alttitle),
    titleRomaji: stringOrNull(extra.title_romaji),
    developers: developers.length > 0 ? developers : brand ? [brand] : [],
    developersOriginal: stringArray(extra.developers_original),
    platforms: stringArray(extra.platforms),
    minage: numberOrNull(extra.minage),
    price: stringOrNull(extra.final_price) ?? stringOrNull(extra.price),
    originalPrice: stringOrNull(extra.original_price),
    discount: numberOrNull(extra.discount),
    store: STORE_PLATE[item.source] ?? null,
    href: internal ?? external,
    external: !internal,
    imageUrl: item.imageUrl ?? null,
    imageSexual: item.imageIsNsfw ? 2 : (numberOrNull(extra.image_sexual) ?? 0),
    rating: numberOrNull(extra.rating),
    votecount: numberOrNull(extra.votecount),
  };
}

/**
 * The days the page draws, newest first, days with nothing on them left out. This is a
 * record of what has happened rather than a plan, so the most recent day leads it.
 *
 * A title known to two sources is placed once, by catalogue id where both name one and by
 * name and day otherwise, which is as much as two stores listing the same work share.
 */
export function buildOutNow({ outNow, today }: { outNow: NewsItem[]; today: string }): OutNowDay[] {
  const from = shiftDay(today, -OUT_NOW_DAYS);
  const seen = new Set<string>();
  const days = new Map<string, OutNowEntry[]>();

  for (const item of outNow) {
    const entry = toEntry(item);
    if (!entry || entry.date < from || entry.date > today) continue;
    const id = entry.vnId ? `v:${entry.vnId}` : `t:${entry.title}|${entry.date}`;
    if (seen.has(id)) continue;
    seen.add(id);
    days.set(entry.date, [...(days.get(entry.date) ?? []), entry]);
  }

  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, entries]) => ({
      // A title the catalogue knows leads the day; the store-only listings follow it.
      date,
      entries: [...entries].sort((a, b) => Number(Boolean(b.vnId)) - Number(Boolean(a.vnId))),
    }));
}
