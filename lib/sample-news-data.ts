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
  { id: 'all', label: 'All Sources', color: 'bg-gray-100 text-gray-800', darkColor: 'dark:bg-gray-700 dark:text-gray-200' },
  { id: 'vndb', label: 'Recently Added to VNDB', color: 'bg-blue-100 text-blue-800', darkColor: 'dark:bg-blue-900/50 dark:text-blue-200' },
  { id: 'vndb_release', label: 'VNDB Releases', color: 'bg-indigo-100 text-indigo-800', darkColor: 'dark:bg-indigo-900/50 dark:text-indigo-200' },
  { id: 'rss', label: 'RSS Feeds', color: 'bg-orange-100 text-orange-800', darkColor: 'dark:bg-orange-900/50 dark:text-orange-200' },
  { id: 'twitter', label: 'Twitter', color: 'bg-sky-100 text-sky-800', darkColor: 'dark:bg-sky-900/50 dark:text-sky-200' },
  { id: 'announcement', label: 'Announcements', color: 'bg-purple-100 text-purple-800', darkColor: 'dark:bg-purple-900/50 dark:text-purple-200' },
];

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

// Fetch news from API
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
    next: { revalidate: 60 }, // Cache for 60 seconds
    signal: AbortSignal.timeout(15000), // 15s timeout
  });

  if (!response.ok) {
    return { ...EMPTY_RESPONSE, error: `Failed to fetch news: ${response.statusText}` };
  }

  const data = await response.json();

  // Basic shape validation
  if (!data || typeof data !== 'object') {
    return { ...EMPTY_RESPONSE, error: 'Invalid response from news service' };
  }
  if (data.items && !Array.isArray(data.items)) {
    return { ...EMPTY_RESPONSE, error: 'Invalid news data format' };
  }

  return data;
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
