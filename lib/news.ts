/**
 * Types, the section registry and the fetchers behind the news pages.
 *
 * Sections are derived from a row's source and mirror the backend's table, so a row filed
 * under a source this file has not heard of still lands in a section (headlines).
 */

import { getBackendUrlOptional } from './config';
import type { Locale } from './i18n/types';
import type { TitlePreference } from './title-preference';

/** The route a news path lives at in a locale: the Japanese tree sits under `/ja`. */
export function newsPath(locale: Locale, path: string): string {
  return locale === 'ja' ? `/ja${path}` : path;
}

/** The same page in the other locale. */
export function counterpartPath(locale: Locale, path: string): string {
  if (locale === 'ja') return path.startsWith('/ja/') ? path.slice(3) : path;
  return `/ja${path}`;
}

const DATE_LOCALE: Record<Locale, string> = { en: 'en-US', ja: 'ja-JP' };

export type NewsSource =
  | 'vndb'
  | 'vndb_release'
  | 'rss'
  | 'twitter'
  | 'bluesky'
  | 'youtube'
  | 'steam'
  | 'dlsite'
  | 'getchu'
  | 'digiket'
  | 'booth'
  | 'melonbooks'
  | 'freem'
  | 'creator'
  | 'note'
  | 'hatena'
  | 'forum'
  | 'reddit'
  | 'board'
  | 'chan'
  | 'jiten'
  | 'vndb_review'
  | 'review'
  | 'bsky_search'
  | 'announcement';

export interface NewsItem {
  id: string;
  source: NewsSource | string;
  sourceLabel: string;
  title: string;
  summary?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  imageIsNsfw?: boolean;
  publishedAt: string;
  tags?: string[] | null;
  extraData?: Record<string, unknown> | null;
  vnId?: string | null;
}

export interface NewsSection {
  slug: string;
  label: string;
  /** One line under the tab row, saying what the section holds. */
  blurb: string;
  sources: readonly string[];
}

export const SECTIONS: readonly NewsSection[] = [
  {
    slug: 'headlines',
    label: 'Headlines',
    blurb: 'Trade press, brand accounts and the club, newest first.',
    sources: ['rss', 'twitter', 'bluesky', 'announcement'],
  },
  {
    slug: 'reviews',
    label: 'Reviews',
    blurb: 'What readers made of them: reviews on VNDB, note and the review blogs, in Japanese and English.',
    sources: ['vndb_review', 'review'],
  },
  {
    slug: 'releases',
    label: 'Releases',
    blurb:
      'Out this week, on sale, listed ahead, and ranked: the catalogue and every store the page reads, commercial and doujin.',
    sources: ['vndb_release', 'steam', 'dlsite', 'getchu', 'digiket', 'booth', 'melonbooks', 'freem'],
  },
  {
    slug: 'community',
    label: 'Community',
    blurb: 'New threads on the boards, forum topics, what readers post, and community writing.',
    sources: ['note', 'hatena', 'forum', 'reddit', 'board', 'chan', 'bsky_search'],
  },
  {
    slug: 'creators',
    label: 'Creators',
    blurb: 'Writers, artists and singers of the scene, on their own accounts.',
    sources: ['creator'],
  },
  {
    slug: 'recently-added',
    label: 'New on VNDB',
    blurb: 'Entries added to the catalogue, a few a day, and new decks on jiten.moe.',
    sources: ['vndb', 'jiten'],
  },
  {
    slug: 'trailers',
    label: 'Trailers',
    blurb: 'Opening movies, PVs and trailers from brand channels.',
    sources: ['youtube'],
  },
];

/**
 * Where each section sits in the tab row. Releases is last of them, beside the schedule:
 * both are about what is out and what is due, and a reader moving between the two should
 * not cross the archives to do it. A section missing from here falls to the end.
 */
const TAB_ORDER: Record<string, number> = {
  headlines: 0,
  reviews: 1,
  community: 2,
  creators: 3,
  'recently-added': 4,
  trailers: 5,
  releases: 6,
};

/** The tab row: the front page, each section, and the schedule last since it is not an archive. */
export const TABS: readonly { slug: string; label: string; href: string }[] = [
  { slug: 'front', label: 'Front page', href: '/news/' },
  ...[...SECTIONS]
    .sort((a, b) => (TAB_ORDER[a.slug] ?? SECTIONS.length) - (TAB_ORDER[b.slug] ?? SECTIONS.length))
    .map((s) => ({ slug: s.slug, label: s.label, href: `/news/${s.slug}/` })),
  { slug: 'upcoming', label: 'Upcoming', href: '/news/upcoming/' },
];

/** Where the front page's DLsite panel sends a reader: the rankings block of the releases page. */
export const DLSITE_PATH = '/news/releases/#rel-ranks';

/** Slugs an inbound link may still carry, and the section each maps to. A date segment is carried across. */
export const LEGACY_SLUGS: Record<string, string> = {
  rss: 'headlines',
  twitter: 'headlines',
  announcements: 'front',
  dlsite: 'releases',
  stores: 'releases',
};

/** The languages sources write in; a row from neither (catalogue, stores) shows under both. */
export type Lang = 'ja' | 'en';
export const LANGS: readonly { code: Lang; label: string }[] = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
];

export function parseLang(value: string | string[] | undefined): Lang | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v === 'ja' || v === 'en' ? v : null;
}

/** The day archive lists every section under this slug. */
export const ALL_SLUG = 'all';

export function sectionBySlug(slug: string): NewsSection | undefined {
  return SECTIONS.find((s) => s.slug === slug);
}

export function sectionForSource(source: string): NewsSection {
  return SECTIONS.find((s) => s.sources.includes(source)) ?? SECTIONS[0];
}

const STORE_SOURCES = new Set(['steam', 'dlsite', 'getchu', 'digiket', 'booth', 'melonbooks', 'freem']);

export function isReleaseSource(source: string): boolean {
  return source === 'vndb_release' || STORE_SOURCES.has(source);
}

/** What a store row is about, from the tag the aggregator filed it under. */
export type StoreKind = 'released' | 'preorder' | 'announced' | 'sale';

export function storeKind(item: NewsItem): StoreKind {
  const tags = item.tags ?? [];
  if (tags.includes('sale')) return 'sale';
  if (tags.includes('preorder')) return 'preorder';
  if (tags.includes('announced')) return 'announced';
  return 'released';
}

/** The plate a store row wears. */
export const STORE_PLATE: Record<string, string> = {
  steam: 'Steam',
  dlsite: 'DLsite',
  getchu: 'Getchu',
  digiket: 'DiGiket',
  booth: 'BOOTH',
  melonbooks: 'Melonbooks',
  freem: 'ふりーむ！',
};

/** The day a listing is due, in whichever key its store wrote; null when it names none. */
export function expectedDate(item: NewsItem): string | null {
  const extra = item.extraData ?? {};
  for (const key of ['expected', 'expected_date']) {
    const value = extra[key];
    if (typeof value === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(value)) return value;
  }
  return null;
}

/** A price as the stores print it, with one yen sign whichever width the store used. */
export function yen(value: string): string {
  return `¥${value.replace(/^[¥￥]\s*/, '')}`;
}

export const STORE_KIND_LABEL: Record<StoreKind, string> = {
  released: 'Out now',
  preorder: 'Pre-order',
  announced: 'Announced',
  sale: 'On sale',
};

export interface DlsiteRankEntry {
  rank: number;
  productId: string;
  site: string;
  title: string;
  titleJp?: string | null;
  titleRomaji?: string | null;
  storeTitle: string;
  maker?: string | null;
  url: string;
  imageUrl?: string | null;
  imageIsNsfw?: boolean;
  vnId?: string | null;
  price?: string | null;
}

export interface DlsiteRankings {
  asOf: string | null;
  pro: DlsiteRankEntry[];
  maniax: DlsiteRankEntry[];
}

export async function fetchDlsiteRankings(): Promise<DlsiteRankings | null> {
  return getJson<DlsiteRankings>('/api/v1/news/dlsite', 1800);
}

/** One thing the aggregator reads, as the backend's registry describes it. */
export interface NewsSourceEntry {
  name: string;
  kind: 'feed' | 'site' | 'youtube' | 'bluesky' | 'x' | 'board' | 'store' | 'api' | string;
  url: string;
  section: string;
  lang?: string | null;
}

export async function fetchSources(): Promise<NewsSourceEntry[]> {
  const data = await getJson<{ sources: NewsSourceEntry[] }>('/api/v1/news/inventory', 86400);
  return data?.sources ?? [];
}

/** The retailer's rankings share the DLsite entry shape. */
export interface GetchuRankings {
  asOf: string | null;
  reserve: DlsiteRankEntry[];
  sales: DlsiteRankEntry[];
}

export async function fetchGetchuRankings(): Promise<GetchuRankings | null> {
  return getJson<GetchuRankings>('/api/v1/news/getchu', 1800);
}

/** The releases page in one call. */
export interface ReleasesPageData {
  outNow: NewsItem[];
  comingUp: NewsItem[];
  onSale: NewsItem[];
  doujin: NewsItem[];
  dlsite?: { asOf?: string | null; pro?: DlsiteRankEntry[]; maniax?: DlsiteRankEntry[] };
  getchu?: { asOf?: string | null; reserve?: DlsiteRankEntry[]; sales?: DlsiteRankEntry[] };
}

export async function fetchReleasesPage(): Promise<ReleasesPageData | null> {
  return getJson<ReleasesPageData>('/api/v1/news/releases', 600);
}

export function isPostSource(source: string): boolean {
  return source === 'twitter' || source === 'bluesky' || source === 'creator' || source === 'bsky_search';
}

export function isReviewSource(source: string): boolean {
  return source === 'vndb_review' || source === 'review';
}

/** The sections whose sources write in both languages, so the switch means something. */
export const LANG_TOGGLE_SECTIONS = ['headlines', 'reviews', 'community'] as const;

export interface FeedPage {
  items: NewsItem[];
  nextCursor: string | null;
  /** The newest row's cursor, which a poll for what arrived since starts from. */
  newestCursor?: string | null;
}

export interface FrontAnnouncement {
  id: number;
  title: string;
  content: string | null;
  url: string | null;
  publishedAt: string;
}

export interface FrontBundle {
  releasesToday: NewsItem[];
  releasesTomorrow: NewsItem[];
  catalogue: NewsItem[];
  trailers: NewsItem[];
  reviews?: NewsItem[];
  sale: NewsItem[];
  announcements: FrontAnnouncement[];
  dlsiteRanking?: DlsiteRankEntry[];
}

export interface RailSectionItems {
  section: string;
  items: NewsItem[];
}

export interface RailVN {
  vnId: string;
  title: string;
  titleJp?: string | null;
  imageUrl?: string | null;
  imageIsNsfw?: boolean;
  count: number;
}

export interface RailReviewer {
  name: string;
  count: number;
  /** The reviewer's page on the source site, where the source names one. */
  url?: string | null;
}

/** What a page's rails and inline modules draw from, in one call. */
export interface RailBundle {
  elsewhere: RailSectionItems[];
  boards: NewsItem[];
  creators: NewsItem[];
  mostReviewed: RailVN[];
  reviewers: RailReviewer[];
  trailers: NewsItem[];
  covers: NewsItem[];
  reviews: NewsItem[];
}

export function emptyRail(): RailBundle {
  return {
    elsewhere: [],
    boards: [],
    creators: [],
    mostReviewed: [],
    reviewers: [],
    trailers: [],
    covers: [],
    reviews: [],
  };
}

export interface DayResponse {
  items: NewsItem[];
  total: number;
  sources: Record<string, number>;
  error?: string;
}

export interface NewsDateInfo {
  date: string;
  count: number;
  sources: Record<string, number>;
}

const EMPTY_PAGE: FeedPage = { items: [], nextCursor: null };
const TIMEOUT_MS = 15000;

async function getJson<T>(path: string, revalidate: number): Promise<T | null> {
  const base = getBackendUrlOptional();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      next: { revalidate },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** The query string a feed request sends, shared between the server fetch and the browser URL. */
function feedQuery(
  section: string,
  opts: { before?: string | null; after?: string | null; limit?: number; lang?: Lang | null },
): string {
  const params = new URLSearchParams({ section, limit: String(opts.limit ?? 30) });
  if (opts.before) params.set('before', opts.before);
  if (opts.after) params.set('after', opts.after);
  if (opts.lang) params.set('lang', opts.lang);
  return params.toString();
}

export async function fetchFeed(
  section: string,
  before?: string,
  limit = 30,
  lang: Lang | null = null,
): Promise<FeedPage> {
  return (await getJson<FeedPage>(`/api/v1/news/feed?${feedQuery(section, { before, limit, lang })}`, 600)) ?? EMPTY_PAGE;
}

export async function fetchFront(): Promise<FrontBundle | null> {
  return getJson<FrontBundle>('/api/v1/news/front', 600);
}

export async function fetchRail(section: string, lang: Lang | null = null): Promise<RailBundle> {
  const params = new URLSearchParams();
  if (lang) params.set('lang', lang);
  const query = params.toString();
  return (
    (await getJson<RailBundle>(`/api/v1/news/rail/${encodeURIComponent(section)}${query ? `?${query}` : ''}`, 600)) ??
    emptyRail()
  );
}

export async function fetchTicker(lang: Lang | null = null, revalidate = 600): Promise<NewsItem[]> {
  const params = new URLSearchParams();
  if (lang) params.set('lang', lang);
  const query = params.toString();
  const data = await getJson<{ items: NewsItem[] }>(`/api/v1/news/ticker${query ? `?${query}` : ''}`, revalidate);
  return data?.items ?? [];
}

/** Everything filed on one UTC day, optionally narrowed to a section. */
export async function fetchDay(date: string, section?: string): Promise<DayResponse> {
  const empty: DayResponse = { items: [], total: 0, sources: {} };
  const params = new URLSearchParams({ date, limit: '200' });
  const data = await getJson<DayResponse>(`/api/v1/news?${params}`, 3600);
  if (!data) return { ...empty, error: 'Unable to load news right now.' };
  if (!section) return data;
  const sources = sectionBySlug(section)?.sources ?? [];
  return { ...data, items: data.items.filter((i) => sources.includes(i.source)) };
}

export async function fetchNewsDates(days = 90): Promise<NewsDateInfo[]> {
  const data = await getJson<{ dates: NewsDateInfo[] }>(`/api/v1/news/dates?days=${days}`, 3600);
  return data?.dates ?? [];
}

/** The public base for a request made from the browser. Server code goes through getJson. */
export const PUBLIC_API_BASE = process.env.NEXT_PUBLIC_VNDB_STATS_API || '';

/** The feed URL a browser asks for, with whichever cursor and filters apply. */
export function feedUrl(
  section: string,
  opts: { before?: string | null; after?: string | null; limit?: number; lang?: Lang | null } = {},
): string {
  return `${PUBLIC_API_BASE}/api/v1/news/feed?${feedQuery(section, opts)}`;
}

export function tickerUrl(lang: Lang | null = null): string {
  const params = new URLSearchParams();
  if (lang) params.set('lang', lang);
  const query = params.toString();
  return `${PUBLIC_API_BASE}/api/v1/news/ticker${query ? `?${query}` : ''}`;
}

export function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

/** News days are filed in UTC. */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function shiftDay(dateStr: string, days: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function formatLongDate(dateStr: string, locale: Locale = 'en'): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(DATE_LOCALE[locale], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Today, Yesterday, Tomorrow, or the weekday and date; days are compared as UTC strings. */
export function dayLabel(dateStr: string, today: string, locale: Locale = 'en'): string {
  const words = locale === 'ja'
    ? { today: '今日', yesterday: '昨日', tomorrow: '明日' }
    : { today: 'Today', yesterday: 'Yesterday', tomorrow: 'Tomorrow' };
  // A weekday and a month day repeat every year, so a heading far from the current day
  // carries the year to say which one it is.
  const distant =
    dateStr.slice(0, 4) !== today.slice(0, 4) ||
    Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dateStr}T00:00:00Z`) > 60 * 86400000;
  const date = new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(DATE_LOCALE[locale], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...(distant ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  });
  // The date always shows; the relative word is a hint beside it, since a page can be
  // served a while after it was built and a reader's own day may differ from the UTC one.
  let relative: string | null = null;
  if (dateStr === today) relative = words.today;
  else if (dateStr === shiftDay(today, -1)) relative = words.yesterday;
  else if (dateStr === shiftDay(today, 1)) relative = words.tomorrow;
  return relative ? `${date} · ${relative}` : date;
}

/** The clock reading of an item, in the zone the days are filed in. */
export function clockLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** A short date for a row seen outside its day: the day if this year, else the year too. */
export function shortDate(iso: string, today: string, locale: Locale = 'en'): string {
  const d = new Date(iso);
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString(DATE_LOCALE[locale], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/** A short day, for a badge: "Sep 6" or "9月6日". */
export function shortDay(dateStr: string, locale: Locale = 'en'): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(DATE_LOCALE[locale], {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** The numeric part of a catalogue id, for the site's own title route. */
export function vnPath(vnId: string | null | undefined): string | null {
  if (!vnId) return null;
  const digits = vnId.replace(/\D/g, '');
  return digits ? `/vn/${digits}/` : null;
}

/** The catalogue's own page for a title, for the link beside a row that leads elsewhere. */
export function vndbUrl(vnId: string | null | undefined): string | null {
  if (!vnId) return null;
  const digits = vnId.replace(/\D/g, '');
  return digits ? `https://vndb.org/v${digits}` : null;
}

export function safeExternalUrl(url: string | null | undefined): string | undefined {
  return url && /^https?:\/\//.test(url) ? url : undefined;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The studios credited on a row, in the script the reader chose. The Japanese names are
 * carried beside the romanised ones and in the same order; a row that has only the one
 * list shows it whichever script is asked for.
 */
export function developerNames(item: NewsItem, preference: TitlePreference): string[] {
  const extra = item.extraData ?? {};
  const original = stringArray(extra.developers_original);
  if (preference === 'japanese' && original.length > 0) return original;
  return stringArray(extra.developers);
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
