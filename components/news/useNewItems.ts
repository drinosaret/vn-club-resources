'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedPage, Lang, NewsItem } from '@/lib/news';
import { feedUrl } from '@/lib/news';

/** How often a visible page asks what arrived. */
export const POLL_MS = 5 * 60 * 1000;

/** The largest page the feed serves. */
const PAGE = 60;

/** How far back a single check walks before it settles for what it has. */
const MAX_PAGES = 3;

/**
 * The moment a keyset cursor names, in milliseconds, or NaN for a cursor that does not
 * decode. A cursor is the row's timestamp and id, joined and encoded for a URL.
 */
function cursorStamp(cursor: string): number {
  try {
    const text = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    return Date.parse(text.split('|')[0]);
  } catch {
    return NaN;
  }
}

/**
 * What arrived in a section since the row the page was built with.
 *
 * The check runs only while the tab is visible and never touches the page: the caller
 * shows the count and inserts on request. The cursor does not move until the caller
 * takes the rows, so each check answers with the whole set that is waiting.
 */
export function useNewItems({
  section,
  lang,
  cursor,
  enabled,
}: {
  section: string;
  lang: Lang | null;
  cursor: string | null;
  enabled: boolean;
}): { items: NewsItem[]; newestCursor: string | null; clear: () => void } {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [newestCursor, setNewestCursor] = useState<string | null>(null);
  const lastRun = useRef(0);
  // A check that resolves after the caller took the rows, or after a later check started,
  // must not put the old answer back.
  const run = useRef(0);

  const check = useCallback(async () => {
    if (!cursor || document.visibilityState !== 'visible') return;
    const gen = (run.current += 1);
    lastRun.current = Date.now();
    const stamp = cursorStamp(cursor);
    try {
      const res = await fetch(feedUrl(section, { after: cursor, limit: PAGE, lang }));
      if (!res.ok) return;
      const page = (await res.json()) as FeedPage;
      const found = [...page.items];
      // An aggregator run can file more rows between two checks than one page holds. The
      // page cursor then points at the oldest row of the page rather than at the oldest
      // row waiting, so the rest are walked back a page at a time until one reaches the
      // row the count started from.
      let older = page.nextCursor ?? null;
      for (let p = 1; older && p < MAX_PAGES && !Number.isNaN(stamp); p += 1) {
        const olderRes = await fetch(feedUrl(section, { before: older, limit: PAGE, lang }));
        if (!olderRes.ok) break;
        const olderPage = (await olderRes.json()) as FeedPage;
        const newer = olderPage.items.filter((i) => Date.parse(i.publishedAt) > stamp);
        found.push(...newer);
        if (newer.length < olderPage.items.length) break;
        older = olderPage.nextCursor ?? null;
      }
      if (gen !== run.current) return;
      const seen = new Set<string>();
      const unique: NewsItem[] = [];
      for (const item of found) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        unique.push(item);
      }
      setItems(unique);
      setNewestCursor(page.newestCursor ?? null);
    } catch {
      // A failed check is answered by the next one.
    }
  }, [section, lang, cursor]);

  useEffect(() => {
    if (!enabled || !cursor) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(check, POLL_MS);
      if (Date.now() - lastRun.current >= POLL_MS) void check();
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
    // The page was just built, so the first check waits a full interval.
    lastRun.current = Date.now();
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, cursor, check]);

  const clear = useCallback(() => {
    run.current += 1;
    setItems([]);
    setNewestCursor(null);
  }, []);

  return { items, newestCursor, clear };
}
