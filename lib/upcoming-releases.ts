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

export type ReleaseDatePrecision = 'day' | 'month' | 'year';

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

/**
 * Read the calendar parts straight off the ISO string. Passing it through Date would
 * shift the day into the viewer's zone, and a release date has no time of day to shift.
 */
function parts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

export function formatReleaseDate(item: UpcomingRelease): string {
  const { year, month, day } = parts(item.released);
  if (item.date_precision === 'year') return String(year);
  if (item.date_precision === 'month') return `${MONTHS[month - 1]} ${year}`;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Short form for a badge, where the group heading already carries the month and year. */
export function formatReleaseDayBadge(item: UpcomingRelease): string {
  const { month, day } = parts(item.released);
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

/**
 * Chronological groups, one per month, plus a group per year for the titles whose month
 * is still unannounced. The year group sits after that year's months: it is the least
 * specific thing known about the year, so it belongs at the end of it rather than in
 * January, which is where the clamped date would otherwise put it.
 *
 * Japanese releases lead each group. Everything on the site assumes the original Japanese
 * is what gets read, so those are the entries a reader came for.
 */
export function groupUpcomingReleases(items: UpcomingRelease[]): UpcomingReleaseGroup[] {
  const groups = new Map<string, UpcomingReleaseGroup & { sort: number }>();

  for (const item of items) {
    const { year, month } = parts(item.released);
    const yearOnly = item.date_precision === 'year';
    const key = yearOnly ? `y${year}` : `m${year}-${String(month).padStart(2, '0')}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: yearOnly ? `${year}, month not announced` : `${MONTHS[month - 1]} ${year}`,
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
      if (a.japanese !== b.japanese) return a.japanese ? -1 : 1;
      return a.released.localeCompare(b.released);
    });
  }

  return ordered.map(({ key, label, kind, items: groupItems }) => ({
    key,
    label,
    kind,
    items: groupItems,
  }));
}
