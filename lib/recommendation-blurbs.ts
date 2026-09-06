import { getBackendUrl } from '@/lib/config';

/**
 * The prose a title carries, fetched separately from the recommendation that named it.
 *
 * Descriptions are long and only one layout shows them, so they are asked for when that
 * layout is in force rather than added to every page of results. They are facts about a
 * title rather than about a query, so what has been fetched stays fetched across a filter
 * change or a tab.
 */

export interface VNBlurb {
  vn_id: string;
  /** Stripped of markup and cut to a readable length before it leaves the backend. */
  description: string | null;
  released: string | null;
}

/** How long to wait before giving up, matching the other per-title fetch on this page. */
const BLURB_TIMEOUT_MS = 15000;

/**
 * Descriptions for a page of results.
 *
 * A failure resolves empty. Nothing here is load bearing: the layout renders every other
 * part of a title without it, and an error banner over a full page of results would be
 * reporting the absence of a subtitle as though the results had failed.
 */
export async function fetchRecommendationBlurbs(ids: string[]): Promise<VNBlurb[]> {
  if (ids.length === 0) return [];

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), BLURB_TIMEOUT_MS);

  try {
    const response = await fetch(`${getBackendUrl()}/api/v1/vn/batch/blurbs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
      signal: abortController.signal,
    });
    clearTimeout(timeoutHandle);
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    return data.map((row) => ({
      vn_id: row.id,
      description: row.description ?? null,
      released: row.released ?? null,
    }));
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (err instanceof Error && err.name !== 'AbortError') {
      console.error('Failed to fetch descriptions:', err);
    }
    return [];
  }
}
