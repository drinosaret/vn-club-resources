/**
 * Server-side fetching and grouping for the upcoming releases page.
 *
 * The backend hands back one entry per title in date order, each carrying how much of its
 * date the VNDB dump actually stated. Everything below turns that into the groups and
 * labels a reader sees, and says only the part of a date that was announced: a title
 * scheduled for a month it has not named a day in must not be printed as the first of
 * that month.
 */

import { getBackendUrlOptional } from './config';
import {
  STORE_PLATE,
  expectedDate,
  numberOrNull,
  safeExternalUrl,
  stringArray,
  stringOrNull,
  type NewsItem,
} from './news';

export type ReleaseDatePrecision = 'day' | 'month' | 'year';

/**
 * What a storefront says about a title it has taken orders for. The catalogue carries the
 * work; this carries the transaction, which is the part only the store knows.
 */
export interface StoreListing {
  /** The store's plate, as the news pages spell it. */
  store: string;
  price: string | null;
  originalPrice: string | null;
  /** What the store throws in with a pre-order, in the store's own words. */
  bonus: string | null;
  url: string | null;
  inStock: boolean | null;
}

/**
 * A studio credit as the API serves it: the catalogue's own name, and its romanisation
 * where one exists. Which is shown is the reader's setting, so both travel.
 */
export interface ProducerCredit {
  name: string;
  original?: string | null;
}

/**
 * Read a credit however the payload spells it.
 *
 * These responses are held for as long as an hour, so an answer fetched before the field
 * grew its second script outlives the code that reads it. A bare name is that answer.
 */
export function toProducerCredit(value: ProducerCredit | string): ProducerCredit {
  return typeof value === 'string' ? { name: value, original: null } : value;
}

export interface UpcomingRelease {
  id: string;
  title: string;
  title_jp?: string | null;
  title_romaji?: string | null;
  image_url?: string | null;
  image_sexual?: number | null;
  released: string;
  date_precision: ReleaseDatePrecision;
  developers: ProducerCredit[];
  platforms: string[];
  languages: string[];
  japanese: boolean;
  minage?: number | null;
  /** Where a store takes orders for this title, where one was read. */
  listing?: StoreListing;
  /**
   * The entry is a storefront listing rather than a catalogue entry: its id is the news
   * row's, not a title id, so it has no page on this site and links to the store instead.
   */
  storeOnly?: true;
  /** How many listings of the same work this row stands for, when more than one. */
  editions?: number;
}

export interface UpcomingReleasesData {
  asOf: string | null;
  items: UpcomingRelease[];
}

export interface UpcomingReleaseGroup {
  /** Stable id, usable as a heading anchor. */
  key: string;
  label: string;
  /** A year group holds the titles whose month is not yet known. */
  kind: 'month' | 'year';
  items: UpcomingRelease[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export type ReleaseLocale = 'en' | 'ja';

/**
 * Read the calendar parts straight off the ISO string. Passing it through Date would
 * shift the day into the viewer's zone, and a release date has no time of day to shift.
 */
function parts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

export function formatReleaseDate(item: UpcomingRelease, locale: ReleaseLocale = 'en'): string {
  const { year, month, day } = parts(item.released);
  if (locale === 'ja') {
    if (item.date_precision === 'year') return `${year}年`;
    if (item.date_precision === 'month') return `${year}年${month}月`;
    return `${year}年${month}月${day}日`;
  }
  if (item.date_precision === 'year') return String(year);
  if (item.date_precision === 'month') return `${MONTHS[month - 1]} ${year}`;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Short form for a badge, where the group heading already carries the month and year. */
export function formatReleaseDayBadge(item: UpcomingRelease, locale: ReleaseLocale = 'en'): string {
  const { month, day } = parts(item.released);
  if (locale === 'ja') {
    if (item.date_precision === 'day') return `${month}月${day}日`;
    return item.date_precision === 'month' ? '日付未定' : '時期未定';
  }
  if (item.date_precision === 'day') return `${MONTHS[month - 1].slice(0, 3)} ${day}`;
  if (item.date_precision === 'month') return 'Day TBA';
  return 'Date TBA';
}

/** The listing page shows every announced title, so it asks for the endpoint's ceiling. */
export const UPCOMING_LIMIT_ALL = 400;

/**
 * How much of the listing a front-page preview needs.
 *
 * A preview shows a handful of titles whose day is known. The backend answers in date order
 * with an unstated day clamped to the first of its period, so an entry missing a day sorts
 * ahead of the dated entries in the same period. The margin over the handful covers that
 * without carrying the rest of the announced set into a render that discards it.
 */
export const UPCOMING_LIMIT_PREVIEW = 40;

export async function getUpcomingReleases(
  limit: number = UPCOMING_LIMIT_ALL,
): Promise<UpcomingReleasesData> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return { asOf: null, items: [] };

  try {
    const res = await fetch(`${backendUrl}/api/v1/vn/upcoming?limit=${limit}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { asOf: null, items: [] };

    const data = (await res.json()) as {
      as_of?: string;
      items?: (Omit<UpcomingRelease, 'developers'> & {
        developers?: (ProducerCredit | string)[];
      })[];
    };
    const items = (data.items ?? []).map((item) => ({
      ...item,
      developers: (item.developers ?? []).map(toProducerCredit),
    }));
    return { asOf: data.as_of ?? null, items };
  } catch {
    return { asOf: null, items: [] };
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What a storefront row says about the sale, or null for a source with no plate. */
function toListing(item: NewsItem): StoreListing | null {
  const store = STORE_PLATE[item.source];
  if (!store) return null;
  const extra = item.extraData ?? {};
  return {
    store,
    price: stringOrNull(extra.final_price) ?? stringOrNull(extra.price),
    originalPrice: stringOrNull(extra.original_price),
    bonus: stringOrNull(extra.bonus),
    url: safeExternalUrl(item.url) ?? null,
    inStock: typeof extra.in_stock === 'boolean' ? extra.in_stock : null,
  };
}

/** A listing's identity: the name it is sold under and the store's own id for it. */
function listingKey(item: NewsItem): string {
  const extra = item.extraData ?? {};
  const id = stringOrNull(extra.soft_id) ?? stringOrNull(extra.product_id) ?? item.url ?? item.id;
  return `${item.title}|${id}`;
}

/** Catalogue ids reach this in either spelling, and the merge below compares them. */
function vnKey(id: string): string {
  const digits = id.replace(/\D/g, '');
  return digits ? `v${digits}` : id;
}

/**
 * A listing as an entry of its own, for a work the catalogue's schedule does not carry.
 * A date already past is dropped: the page is what is still ahead.
 */
function toStoreEntry(item: NewsItem, listing: StoreListing, today: string): UpcomingRelease | null {
  const due = expectedDate(item);
  if (!due) return null;
  const day = DAY.test(due);
  if (day ? due < today : due < today.slice(0, 7)) return null;
  const extra = item.extraData ?? {};
  const brand = stringOrNull(extra.brand) ?? stringOrNull(extra.maker) ?? stringArray(extra.developers)[0];
  return {
    id: item.id,
    title: item.title,
    // These stores write in Japanese, so the store's own name for a work is the one the
    // row shows and the one it declares a language for.
    title_jp: stringOrNull(extra.alttitle) ?? item.title,
    title_romaji: stringOrNull(extra.title_romaji),
    image_url: item.imageUrl ?? null,
    image_sexual: item.imageIsNsfw ? 2 : (numberOrNull(extra.image_sexual) ?? 0),
    released: day ? due : `${due}-01`,
    date_precision: day ? 'day' : 'month',
    developers: brand ? [{ name: brand, original: null }] : [],
    platforms: stringArray(extra.platforms),
    languages: ['ja'],
    japanese: true,
    minage: numberOrNull(extra.minage),
    listing,
    storeOnly: true,
  };
}

/**
 * The tails a storefront adds to a title to tell one package of it from another: the
 * platform it is cut for, how limited the pressing is, whether it is a box or a bundle.
 * Longest first, so a marker that ends with a shorter one is taken whole.
 */
const EDITION_MARKERS = [
  'Nintendo Switch版',
  '完全生産限定版',
  'ダウンロード版',
  '豪華限定版',
  '初回限定版',
  'デキ愛BOX',
  'Switch版',
  'PS4版',
  'PS5版',
  'PC版',
  '初回版',
  '通常版',
  '限定版',
  'DL版',
  'BOX',
  'セット',
].sort((a, b) => b.length - a.length);

/** A bracketed note at the end of a store title, which names the package rather than the work. */
const TRAILING_NOTE = /[【（(][^】）)]*[】）)]\s*$/;

/** What is left of a store's name for a package once the package part is taken off. */
export function baseStoreTitle(title: string): string {
  let base = title.trim();
  for (let stripped = true; stripped; ) {
    stripped = false;
    const withoutNote = base.replace(TRAILING_NOTE, '').trim();
    if (withoutNote !== base && withoutNote.length > 0) {
      base = withoutNote;
      stripped = true;
    }
    for (const marker of EDITION_MARKERS) {
      // A title that is nothing but a marker is the work's own name, not a package of it.
      if (base.length > marker.length && base.toLowerCase().endsWith(marker.toLowerCase())) {
        base = base.slice(0, base.length - marker.length).replace(/[\s・:：-]+$/, '').trim();
        stripped = true;
        break;
      }
    }
  }
  return base;
}

/** A price as a number for comparison; a listing with no price sorts last. */
function priceValue(price: string | null | undefined): number {
  const digits = (price ?? '').replace(/\D/g, '');
  return digits ? Number(digits) : Number.POSITIVE_INFINITY;
}

/**
 * One row per work rather than one per package.
 *
 * A store that sells a title as a standard edition, a limited box and a console cut lists
 * each separately, which reads as several announcements of the same thing. Packages are
 * folded together when the name under the package part, the brand and the month all agree;
 * the cheapest of the earliest stands for the rest, carrying every platform between them.
 */
function foldEditions(entries: UpcomingRelease[]): UpcomingRelease[] {
  const groups = new Map<string, UpcomingRelease[]>();
  for (const entry of entries) {
    const key = [baseStoreTitle(entry.title), entry.developers[0]?.name ?? '', entry.released.slice(0, 7)].join('|');
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const [kept] = [...group].sort((a, b) => {
      const byDate = a.released.localeCompare(b.released);
      return byDate !== 0 ? byDate : priceValue(a.listing?.price) - priceValue(b.listing?.price);
    });
    return {
      ...kept,
      platforms: [...new Set(group.flatMap((entry) => entry.platforms))],
      editions: group.length,
    };
  });
}

/**
 * The catalogue's schedule with the storefront listings folded into it.
 *
 * A listing of a title the schedule already carries becomes that entry's sale details, so
 * the price and the pre-order bonus sit on the row a reader was going to read anyway. A
 * listing of anything else stands as an entry of its own, under the day its store names,
 * with the packages of one work folded into a single row. Two listings of the same work
 * from one store are the same listing.
 */
export function mergeStoreListings(
  items: UpcomingRelease[],
  comingUp: NewsItem[],
  today: string,
): UpcomingRelease[] {
  const merged = items.map((item) => ({ ...item }));
  const byVn = new Map(merged.map((item) => [vnKey(item.id), item]));
  const seen = new Set<string>();
  const storeOnly: UpcomingRelease[] = [];

  for (const row of comingUp) {
    const listing = toListing(row);
    if (!listing) continue;
    const key = listingKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const known = row.vnId ? byVn.get(vnKey(row.vnId)) : undefined;
    if (known) {
      // The first store to list a title carries it; a second listing of the same work
      // would only repeat what the row already says.
      if (!known.listing) known.listing = listing;
      continue;
    }
    const entry = toStoreEntry(row, listing, today);
    if (entry) storeOnly.push(entry);
  }

  return [...merged, ...foldEditions(storeOnly)];
}

/**
 * Chronological groups, one per month, plus a group per year for the titles whose month
 * is still unannounced. The year group sits after that year's months: it is the least
 * specific thing known about the year, so it belongs at the end of it rather than in
 * January, which is where the clamped date would otherwise put it.
 *
 * A group runs in date order: the dates are the point of it, and an entry whose day is
 * unstated sorts to the head of its period, which is as much as is known about it. Where a
 * day carries both, the catalogue's own entries lead the listings only a store knows,
 * since those are the ones with a page on this site.
 */
export function groupUpcomingReleases(
  items: UpcomingRelease[],
  locale: ReleaseLocale = 'en',
): UpcomingReleaseGroup[] {
  const groups = new Map<string, UpcomingReleaseGroup & { sort: number }>();

  for (const item of items) {
    const { year, month } = parts(item.released);
    const yearOnly = item.date_precision === 'year';
    const key = yearOnly ? `y${year}` : `m${year}-${String(month).padStart(2, '0')}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label:
          locale === 'ja'
            ? yearOnly ? `${year}年（月未定）` : `${year}年${month}月`
            : yearOnly ? `${year}, month not announced` : `${MONTHS[month - 1]} ${year}`,
        kind: yearOnly ? 'year' : 'month',
        items: [],
        sort: year * 100 + (yearOnly ? 13 : month),
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }

  const ordered = [...groups.values()].sort((a, b) => a.sort - b.sort);
  for (const group of ordered) {
    group.items.sort((a, b) => {
      const byDate = a.released.localeCompare(b.released);
      if (byDate !== 0) return byDate;
      if (Boolean(a.storeOnly) !== Boolean(b.storeOnly)) return a.storeOnly ? 1 : -1;
      return a.title.localeCompare(b.title);
    });
  }

  return ordered.map(({ key, label, kind, items: groupItems }) => ({
    key,
    label,
    kind,
    items: groupItems,
  }));
}
