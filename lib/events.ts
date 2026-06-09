/**
 * Server-side fetching for the club calendar (events).
 * Uses Next.js ISR for automatic revalidation.
 */

import { getBackendUrlOptional } from './config';
import { getVNForMetadata } from './vndb-server';
import type { VNDetail } from './vndb-stats-api';

export type EventType = 'vn_of_month' | 'vn_of_season' | 'movie_night' | 'custom' | string;

export interface EventItem {
  id: number;
  event_type: EventType;
  title: string;
  title_jp?: string | null; // Japanese title variant (shown when title pref = japanese)
  title_romaji?: string | null; // romanized/English title variant
  description: string | null;
  start_at: string; // ISO 8601 (UTC)
  end_at: string | null;
  all_day: boolean;
  image_url: string | null; // safe-for-metadata cover (null for NSFW); used in JSON-LD
  cover_url?: string | null; // blur-capable cover for the site (present even for NSFW)
  image_sexual?: number | null; // NSFW score; >= 1.5 is blurred
  url: string | null;
  location: string | null;
  is_active: boolean;
  external_key: string | null;
  created_by: string | null;
}

/**
 * Events overlapping a given month. Returns [] if the backend is unavailable.
 * revalidate: ISR window in seconds. The /events page (force-dynamic) passes 0 for
 * fresh data; the home page passes a window so it stays ISR (a no-store fetch would
 * make the whole home route dynamic + uncached).
 */
export async function getEventsForMonth(
  year: number,
  month: number,
  revalidate = 0,
): Promise<EventItem[]> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return [];

  try {
    const res = await fetch(`${backendUrl}/api/v1/events?year=${year}&month=${month}`, {
      next: { revalidate },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.events ?? [];
  } catch {
    return [];
  }
}

const SEASON_BY_MONTH: Record<number, string> = { 0: 'Winter', 3: 'Spring', 6: 'Summer', 9: 'Fall' };

export interface ClubPick {
  vn: VNDetail; // full VN data so the card can show score/developer/tags
  period: string; // e.g. "May 2026" or "Spring 2026"
}

/**
 * The most recently selected VN of the Month and VN of the Season, each resolved
 * to full VN data (score, developers, tags) so the home cards can mirror the VN
 * of the Day card. null when none has been selected. Scans the last few months so
 * a just-rolled month/season still shows the previous pick until a new one lands.
 */
export async function getRecentClubPicks(): Promise<{
  month: ClubPick | null;
  season: ClubPick | null;
}> {
  const now = new Date();
  const months = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return getEventsForMonth(d.getUTCFullYear(), d.getUTCMonth() + 1, 300); // keep home ISR
  });
  const all = (await Promise.all(months)).flat();
  const nowMs = now.getTime();
  const latest = (type: EventType) =>
    all
      .filter((e) => e.event_type === type && e.is_active && new Date(e.start_at).getTime() <= nowMs)
      .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())[0] ?? null;

  const resolve = async (e: EventItem | null, kind: 'month' | 'season'): Promise<ClubPick | null> => {
    const id = e?.url?.match(/\/vn\/(\d+)/)?.[1];
    if (!e || !id) return null;
    const vn = await getVNForMetadata(id);
    if (!vn) return null;
    const start = new Date(e.start_at);
    const period =
      kind === 'season'
        ? `${SEASON_BY_MONTH[start.getUTCMonth()] ?? ''} ${start.getUTCFullYear()}`.trim()
        : start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return { vn, period };
  };

  const [month, season] = await Promise.all([
    resolve(latest('vn_of_month'), 'month'),
    resolve(latest('vn_of_season'), 'season'),
  ]);
  return { month, season };
}

/**
 * Soonest upcoming events. Returns [] if the backend is unavailable.
 */
export async function getUpcomingEvents(limit = 20): Promise<EventItem[]> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return [];

  try {
    const res = await fetch(`${backendUrl}/api/v1/events/upcoming?limit=${limit}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
