/**
 * What is being read now, and which way it is moving.
 *
 * A plain count of the week's votes barely moves, so on its own it says nothing. Each period
 * carries the period before it, and the movers carry the place they held last time, which is
 * where a release or a burst of attention actually shows up.
 *
 * A page that cannot reach the backend renders without this section rather than with an empty
 * one. Absent is honest; a zero is not, which is why every figure that can be missing is typed
 * as missing rather than defaulted.
 *
 * The types here are named apart from the ones in vndb-stats-api for the same endpoint. Those
 * describe the full payload for the trends page; these describe the subset a front page needs,
 * with the places already differenced. Two shapes under one name is a trap.
 */

import { getBackendUrlOptional } from './config';
import { safeHomepageCover } from './safe-cover';

/** The endpoint defaults to Japanese originals; 'all' is available for a surface that wants it. */
export type HotLanguage = 'all' | 'ja';

export type HotPeriodKey = 'week' | 'month' | 'year';

/** One title inside a period, with the window it is in and the window before it. */
export interface HotFeedMover {
  id: string;
  title: string;
  title_jp?: string | null;
  title_romaji?: string | null;
  href: string;
  image_url?: string | null;
  image_sexual?: number | null;
  /** Votes inside this window, and inside the one before it. */
  current: number;
  previous: number;
  /** Where the title stands on this window's ranking. */
  place: number;
  /**
   * Where it stood on the last one, or null when it drew no votes at all in that window.
   * A title arriving from nowhere is the largest climb there is, so it is carried rather than
   * dropped, and the absence is what says so.
   */
  previous_place: number | null;
  /** The backend's own measure of the jump, carried as served rather than re-derived. */
  lift: number;
  /** Places gained, so a consumer gets one number instead of subtracting two. Null where there
   *  is no previous place to subtract from. Negative for a slip. */
  placeChange: number | null;
}

export interface HotFeedPeriod {
  key: HotPeriodKey;
  /** The window's length, which is what makes the counts comparable across periods. */
  days: number | null;
  votes: number;
  previous_votes: number | null;
  movers: HotFeedMover[];
}

export interface HotFeed {
  /** The day the figures were taken from, which is the last day the dump covers. */
  reference: string | null;
  periods: HotFeedPeriod[];
  /** The seven-day window, which is the one a front page leads with. */
  week: HotFeedPeriod | null;
}

/** Long enough to be cheap, short enough that a daily import shows up the same day. */
const HOT_NOW_REVALIDATE_SECONDS = 1800;

/** Matches the other server fetchers, so a backend that accepts and stalls cannot hang a render. */
const REQUEST_TIMEOUT_MS = 30000;

const PERIOD_KEYS: readonly string[] = ['week', 'month', 'year'];

/** A row is usable once it can be placed and linked. Everything else has a stated absence. */
function isMoverRow(row: unknown): row is Omit<HotFeedMover, 'placeChange'> {
  const r = row as Record<string, unknown> | null;
  return Boolean(
    r &&
      typeof r.id === 'string' &&
      typeof r.href === 'string' &&
      typeof r.current === 'number' &&
      typeof r.place === 'number',
  );
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** Covers here go through the same front-page pass the rest of the page uses. See safe-cover. */
async function safen(list: Array<Omit<HotFeedMover, 'placeChange'>>): Promise<HotFeedMover[]> {
  return Promise.all(
    list.map(async (row) => {
      const cover = await safeHomepageCover(row.id, row.image_url, row.image_sexual);
      const previousPlace = num(row.previous_place);
      return {
        ...row,
        previous_place: previousPlace,
        placeChange: previousPlace === null ? null : previousPlace - row.place,
        image_url: cover.imageUrl,
        image_sexual: cover.imageSexual,
      };
    }),
  );
}

async function period(input: unknown): Promise<HotFeedPeriod | null> {
  const raw = input as Record<string, unknown> | null;
  if (!raw || typeof raw.key !== 'string' || !PERIOD_KEYS.includes(raw.key)) return null;
  if (typeof raw.votes !== 'number') return null;

  const rows = Array.isArray(raw.movers) ? raw.movers.filter(isMoverRow) : [];

  return {
    key: raw.key as HotPeriodKey,
    days: num(raw.days),
    votes: raw.votes,
    previous_votes: num(raw.previous_votes),
    movers: await safen(rows),
  };
}

export async function getHotNow(language: HotLanguage = 'ja'): Promise<HotFeed | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  try {
    const res = await fetch(`${backendUrl}/api/v1/stats/global/hot-now?language=${language}`, {
      next: { revalidate: HOT_NOW_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const raw = Array.isArray(data?.periods) ? data.periods : [];
    const periods = (await Promise.all(raw.map(period))).filter(
      (p): p is HotFeedPeriod => p !== null,
    );

    // The nightly job leaves the payload empty until it has run, and an empty section is not
    // worth the heading over it.
    if (periods.length === 0) return null;

    return {
      reference: typeof data?.reference === 'string' ? data.reference : null,
      periods,
      week: periods.find((p) => p.key === 'week') ?? null,
    };
  } catch {
    return null;
  }
}
