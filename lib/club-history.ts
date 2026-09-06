/**
 * Presentation helpers for the archive of past club picks.
 *
 * Pure and dependency-free so both the page and its row component can use them
 * without either pulling in the server-side events client.
 */

import type { EventItem, EventType } from './events';

const SEASON_BY_MONTH: Record<number, string> = {
  0: 'Winter',
  3: 'Spring',
  6: 'Summer',
  9: 'Fall',
};

// Stored titles carry their own type label, because the same row is rendered in a
// Discord embed where nothing else says what kind of pick it is. On a page whose
// rows are already badged by type the label is repetition, so it comes off here.
const TYPE_LABEL_PREFIX: Record<string, string> = {
  vn_of_month: 'VN of the Month',
  vn_of_season: 'VN of the Season',
  roudoku: 'Weekly Roudoku',
  movie_night: 'Movie Night',
};

export function stripTypeLabel(title: string, eventType: EventType): string {
  const prefix = TYPE_LABEL_PREFIX[eventType];
  if (!prefix) return title;
  const withSeparator = `${prefix}: `;
  return title.startsWith(withSeparator) ? title.slice(withSeparator.length) || title : title;
}

/**
 * The period a pick covers, in the terms the club states it: a month for the
 * monthly pick, a season for the seasonal one, and the day itself for a session
 * that happened once.
 */
export function pickPeriodLabel(eventType: EventType, startAt: string): string {
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return '';
  if (eventType === 'vn_of_season') {
    const season = SEASON_BY_MONTH[d.getUTCMonth()];
    if (season) return `${season} ${d.getUTCFullYear()}`;
  }
  if (eventType === 'vn_of_month' || eventType === 'vn_of_season') {
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** /vn/123/ -> "v123", the id the cover reveal and the VN pages are keyed by. */
export function vnIdFromUrl(url: string | null | undefined): string | null {
  const m = url?.match(/^\/vn\/(\d+)\/?$/);
  return m ? `v${m[1]}` : null;
}

export interface PickYearGroup {
  year: number;
  items: EventItem[];
}

/**
 * Picks grouped into years, newest year first, preserving the order they arrive
 * in within each year. A row with an unreadable date is dropped rather than
 * collected under a year that does not exist.
 */
export function groupPicksByYear(items: EventItem[]): PickYearGroup[] {
  const groups = new Map<number, EventItem[]>();
  for (const item of items) {
    const d = new Date(item.start_at);
    if (Number.isNaN(d.getTime())) continue;
    const year = d.getUTCFullYear();
    const bucket = groups.get(year);
    if (bucket) bucket.push(item);
    else groups.set(year, [item]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, groupItems]) => ({ year, items: groupItems }));
}
