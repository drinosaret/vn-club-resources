// News types and utilities for the news aggregator

export type NewsSource = 'vndb' | 'vndb_release' | 'twitter' | 'rss' | 'announcement';

export interface NewsItem {
  id: string;
  title: string;
  summary: string | null;
  source: NewsSource;
  sourceLabel: string;
  url?: string | null;
  imageUrl?: string | null;
  imageIsNsfw?: boolean;
  publishedAt: string; // ISO date string
  tags?: string[] | null;
  extraData?: Record<string, unknown> | null;
}

// Digest card containing multiple news items grouped by date
export interface NewsDigestItem {
  type: 'digest';
  id: string;
  source: NewsSource;
  sourceLabel: string;
  title: string; // e.g., "Newly Added to VNDB - January 16, 2026"
  date: string; // ISO date string
  count: number;
  items: NewsItem[];
  publishedAt: string;
  previewImages: string[];
}

// Union type for news feed items
export interface NewsListItem {
  type: 'item' | 'digest';
  // Common fields
  id: string;
  source: NewsSource;
  sourceLabel: string;
  title: string;
  publishedAt: string;
  // Individual item fields
  summary?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  imageIsNsfw?: boolean;
  tags?: string[] | null;
  extraData?: Record<string, unknown> | null;
  // Digest item fields
  date?: string;
  count?: number;
  items?: NewsItem[];
  previewImages?: string[];
}

export interface NewsSourceConfig {
  id: NewsSource | 'all';
  label: string;
  color: string;
  darkColor: string;
}

export interface NewsListResponse {
  items: NewsListItem[];
  total: number;
  page: number;
  pages: number;
  sources: Record<string, number>;
  error?: string;
}

export const newsSources: NewsSourceConfig[] = [
  { id: 'all', label: 'All Sources', color: 'bg-gray-100 text-gray-800', darkColor: 'dark:bg-gray-500/20 dark:text-gray-300' },
  { id: 'vndb', label: 'Recently Added to VNDB', color: 'bg-blue-100 text-blue-800', darkColor: 'dark:bg-blue-500/20 dark:text-blue-300' },
  { id: 'vndb_release', label: 'VNDB Releases', color: 'bg-indigo-100 text-indigo-800', darkColor: 'dark:bg-indigo-500/20 dark:text-indigo-300' },
  { id: 'rss', label: 'RSS Feeds', color: 'bg-orange-100 text-orange-800', darkColor: 'dark:bg-orange-500/20 dark:text-orange-300' },
  { id: 'twitter', label: 'Twitter', color: 'bg-sky-100 text-sky-800', darkColor: 'dark:bg-sky-500/20 dark:text-sky-300' },
  { id: 'announcement', label: 'Announcements', color: 'bg-purple-100 text-purple-800', darkColor: 'dark:bg-purple-500/20 dark:text-purple-300' },
];

// URL slug mapping for digest permalinks (legacy)
export const DIGEST_SLUG_MAP: Record<string, string> = {
  vndb: 'recently-added',
  vndb_release: 'releases',
};

export const SLUG_TO_SOURCE: Record<string, string> = {
  'recently-added': 'vndb',
  releases: 'vndb_release',
};

export const DIGEST_TYPE_LABELS: Record<string, string> = {
  'recently-added': 'Recently Added to VNDB',
  releases: 'VN Releases',
};

// ============ Tab-based routing ============

/** Tab slug → backend source value (undefined = all sources) */
export const TAB_SLUGS: Record<string, string | undefined> = {
  all: undefined,
  'recently-added': 'vndb',
  releases: 'vndb_release',
  rss: 'rss',
  twitter: 'twitter',
  announcements: 'announcement',
};

/** Tab slug → display label */
export const TAB_LABELS: Record<string, string> = {
  all: 'All Sources',
  'recently-added': 'Recently Added to VNDB',
  releases: 'VN Releases',
  rss: 'RSS Feeds',
  twitter: 'Twitter',
  announcements: 'Announcements',
};

/** Ordered list of tab configs for rendering navigation */
export const TAB_LIST = [
  { slug: 'all', label: 'All Sources' },
  { slug: 'recently-added', label: 'Recently Added' },
  { slug: 'releases', label: 'Releases' },
  { slug: 'rss', label: 'RSS Feeds' },
  { slug: 'twitter', label: 'Twitter' },
  { slug: 'announcements', label: 'Announcements' },
] as const;

export function isValidTab(tab: string): boolean {
  return tab in TAB_SLUGS;
}

// API base URL - can be overridden via environment variable
const API_BASE_URL = process.env.NEXT_PUBLIC_NEWS_API_URL || process.env.NEXT_PUBLIC_API_URL || '';

// Validate API URL in development
if (process.env.NODE_ENV === 'development' && !API_BASE_URL) {
  console.warn(
    '[News] No API URL configured. Set NEXT_PUBLIC_NEWS_API_URL or NEXT_PUBLIC_API_URL in your .env.local file.'
  );
}

// Empty response for when API is not configured
const EMPTY_RESPONSE: NewsListResponse = {
  items: [],
  total: 0,
  page: 1,
  pages: 0,
  sources: {},
};

// ============ Fetch functions ============

/** Fetch news from API (legacy paginated feed) */
export async function fetchNews(options?: {
  page?: number;
  limit?: number;
  source?: NewsSource;
}): Promise<NewsListResponse> {
  if (!API_BASE_URL) {
    return { ...EMPTY_RESPONSE, error: 'News service is not configured' };
  }

  const params = new URLSearchParams();
  if (options?.page) params.set('page', options.page.toString());
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.source) params.set('source', options.source);

  const url = `${API_BASE_URL}/api/v1/news${params.toString() ? `?${params}` : ''}`;

  const response = await fetch(url, {
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    return { ...EMPTY_RESPONSE, error: `Failed to fetch news: ${response.statusText}` };
  }

  const data = await response.json();

  if (!data || typeof data !== 'object') {
    return { ...EMPTY_RESPONSE, error: 'Invalid response from news service' };
  }
  if (data.items && !Array.isArray(data.items)) {
    return { ...EMPTY_RESPONSE, error: 'Invalid news data format' };
  }

  return data;
}

/** Fetch news items for a specific date (flat, no digest grouping) */
export async function fetchNewsForDate(options: {
  date: string;
  source?: string;
  limit?: number;
}): Promise<NewsListResponse> {
  if (!API_BASE_URL) {
    return { ...EMPTY_RESPONSE, error: 'News service is not configured' };
  }

  const params = new URLSearchParams();
  params.set('date', options.date);
  params.set('limit', (options.limit ?? 200).toString());
  if (options.source) params.set('source', options.source);

  const url = `${API_BASE_URL}/api/v1/news?${params}`;

  try {
    const response = await fetch(url, {
      next: { revalidate: 300 }, // 5 min for date pages
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { ...EMPTY_RESPONSE, error: `Failed to fetch news: ${response.statusText}` };
    }

    const data = await response.json();
    return data;
  } catch {
    return { ...EMPTY_RESPONSE, error: 'Unable to load news right now.' };
  }
}

/** Date info returned by /dates endpoint */
export interface NewsDateInfo {
  date: string;       // YYYY-MM-DD
  count: number;
  sources: Record<string, number>;
}

/** Fetch available dates with content (for date picker) */
export async function fetchNewsDates(options?: {
  source?: string;
  days?: number;
}): Promise<NewsDateInfo[]> {
  if (!API_BASE_URL) return [];

  const params = new URLSearchParams();
  if (options?.source) params.set('source', options.source);
  if (options?.days) params.set('days', options.days.toString());

  const url = `${API_BASE_URL}/api/v1/news/dates?${params}`;

  try {
    const response = await fetch(url, {
      next: { revalidate: 3600 }, // 1 hour cache
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return [];
    const data = await response.json();
    return data.dates || [];
  } catch {
    return [];
  }
}

// Response type for a single digest
export interface DigestResponse {
  type: 'digest';
  id: string;
  source: string;
  sourceLabel: string;
  title: string;
  date: string;
  count: number;
  items: NewsItem[];
  publishedAt: string;
  previewImages: string[];
}

/**
 * Fetch a specific digest by type slug and date.
 * Used by digest permalink pages (server-side).
 */
export async function fetchDigest(
  typeSlug: string,
  date: string,
): Promise<DigestResponse | null> {
  if (!API_BASE_URL) return null;

  const url = `${API_BASE_URL}/api/v1/news/digest/${encodeURIComponent(typeSlug)}/${encodeURIComponent(date)}`;

  try {
    const response = await fetch(url, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return null;

    return response.json();
  } catch {
    return null;
  }
}

// Empty fallback when API is unavailable
export const sampleNewsItems: NewsItem[] = [];

// Helper to filter news by source
export function filterNewsBySource(items: NewsItem[], source: NewsSource | 'all'): NewsItem[] {
  if (source === 'all') return items;
  return items.filter(item => item.source === source);
}

// Helper to get source config
export function getSourceConfig(source: NewsSource | 'all'): NewsSourceConfig | undefined {
  return newsSources.find(s => s.id === source);
}

// Helper to format relative time
export function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return 'just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
