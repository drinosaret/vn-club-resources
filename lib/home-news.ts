/**
 * The few news items the front page shows.
 *
 * The news section has its own pages and its own filters. This is only the top of the pile, so
 * somebody arriving at the site can see whether anything happened without going looking.
 *
 * Only sources that carry visual novel news are asked for. The unfiltered listing returns
 * nothing, so each source is requested by name and the results are merged by date.
 */

import { getBackendUrlOptional } from './config';

export interface HomeNewsItem {
  id: string;
  title: string;
  /** The catalogue's other-script name, so a row can follow the reader's title setting. */
  title_jp?: string | null;
  summary?: string | null;
  url?: string | null;
  source: string;
  sourceLabel?: string | null;
  publishedAt?: string | null;
}

/** Matches how often the aggregator runs, so the page is never far behind it. */
const NEWS_REVALIDATE_SECONDS = 1800;

/** Matches the other server fetchers, so a backend that accepts and stalls cannot hang a render. */
const REQUEST_TIMEOUT_MS = 30000;

/** Newly catalogued titles first, then announced releases. */
const SOURCES = ['vndb', 'vndb_release'] as const;

/** The catalogue keeps its other-script name in the free-form bag rather than in a column. */
interface NewsRow extends HomeNewsItem {
  extraData?: Record<string, unknown> | null;
}

async function fromSource(backendUrl: string, source: string, limit: number): Promise<HomeNewsItem[]> {
  try {
    const res = await fetch(
      `${backendUrl}/api/v1/news?source=${encodeURIComponent(source)}&limit=${limit}`,
      { next: { revalidate: NEWS_REVALIDATE_SECONDS }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    return items
      .filter((row: NewsRow) => row && row.id && row.title)
      .map((row: NewsRow) => ({
        id: String(row.id),
        title: row.title,
        title_jp: typeof row.extraData?.alttitle === 'string' ? row.extraData.alttitle : null,
        summary: row.summary ?? null,
        url: row.url ?? null,
        source: row.source,
        sourceLabel: row.sourceLabel ?? null,
        publishedAt: row.publishedAt ?? null,
      }));
  } catch {
    return [];
  }
}

export async function getHomeNews(limit = 6): Promise<HomeNewsItem[]> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return [];

  const batches = await Promise.all(SOURCES.map((s) => fromSource(backendUrl, s, limit)));
  const merged = batches.flat();

  // Newest first across the sources, since a reader does not care which feed a thing came from.
  merged.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

  const seen = new Set<string>();
  return merged.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true))).slice(0, limit);
}
