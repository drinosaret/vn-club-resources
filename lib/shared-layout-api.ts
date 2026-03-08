/**
 * API client for shared layout (grid / tier list) links.
 */

import { getBackendUrlOptional } from './config';

let _backendUrl: string | undefined;
function getUrl(): string {
  if (!_backendUrl) {
    _backendUrl = getBackendUrlOptional();
    if (!_backendUrl) throw new Error('Backend URL not configured');
  }
  return _backendUrl;
}

export interface SharedLayoutData {
  id: string;
  type: 'grid' | 'tierlist';
  data: Record<string, unknown>;
  created_at: string;
}

/** Fetch a shared layout by ID. */
export async function fetchSharedLayout(shareId: string): Promise<SharedLayoutData> {
  const res = await fetch(`${getUrl()}/api/v1/shared/${encodeURIComponent(shareId)}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error('not_found');
    throw new Error(`Failed to fetch shared layout: ${res.status}`);
  }
  return res.json();
}

/** Create a shared layout link, returns the short ID. */
export async function createSharedLayout(
  type: 'grid' | 'tierlist',
  data: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${getUrl()}/api/v1/shared`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, data }),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error('rate_limited');
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to create shared layout: ${res.status}`);
  }
  const { id } = await res.json();
  return id;
}

type BatchItem = {
  id: string; title: string; title_jp?: string; title_romaji?: string;
  image_url?: string; image_sexual?: number;
};

const BATCH_CHUNK_SIZE = 100;

/** Fetch a batch endpoint in chunks of 100 (backend limit). */
async function fetchBatchChunked(endpoint: string, ids: string[]): Promise<BatchItem[]> {
  if (!ids.length) return [];
  const url = `${getUrl()}${endpoint}`;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + BATCH_CHUNK_SIZE));
  }
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: chunk }),
      });
      if (!res.ok) return [];
      return res.json() as Promise<BatchItem[]>;
    }),
  );
  return results.flat();
}

/** Batch-fetch minimal VN metadata by IDs. */
export async function fetchBatchVNs(ids: string[]): Promise<BatchItem[]> {
  return fetchBatchChunked('/api/v1/vn/batch', ids);
}

/** Batch-fetch minimal character metadata by IDs. */
export async function fetchBatchCharacters(ids: string[]): Promise<BatchItem[]> {
  return fetchBatchChunked('/api/v1/characters/batch', ids);
}

/**
 * Copy async-generated text to clipboard, preserving the user gesture.
 *
 * Must be called SYNCHRONOUSLY in the click handler (before any await).
 * Uses ClipboardItem with a promise-based blob so the browser holds the
 * gesture permission while the async data resolves.
 *
 * Returns { copied: boolean, text: string } — text is the resolved value
 * so the caller can show it as fallback if copy failed.
 */
export function copyAsyncText(textPromise: Promise<string>): Promise<{ copied: boolean; text: string }> {
  // Modern approach: ClipboardItem with a promise preserves the user gesture
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blobPromise = textPromise.then(t => new Blob([t], { type: 'text/plain' }));
      const item = new ClipboardItem({ 'text/plain': blobPromise as unknown as Blob });
      return navigator.clipboard.write([item])
        .then(() => textPromise.then(t => ({ copied: true, text: t })))
        .catch(() => textPromise.then(t => ({ copied: false, text: t })));
    } catch {
      // ClipboardItem construction failed — fall through
    }
  }
  // Fallback: wait for text, then try writeText (may fail without gesture)
  return textPromise.then(async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return { copied: true, text };
    } catch { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return { copied: true, text };
    } catch { /* fall through */ }
    return { copied: false, text };
  });
}
