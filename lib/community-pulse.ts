/**
 * What the reading community is doing this week.
 *
 * The front page is a place people come back to, so the part of it that changes has to be
 * real: which titles are being picked up and put down, how much reading is happening, and
 * what is about to arrive. All of it is derived from the vote record rather than written by
 * hand, which is why the page can say it and mean it.
 *
 * A page that cannot reach the backend renders without these sections rather than with empty
 * ones. Absent is honest; a zero is not.
 */

import { getBackendUrlOptional } from './config';
import { safeHomepageCover } from './safe-cover';

/**
 * One title as the trend feed names it, with everything needed to draw a cover and link it.
 *
 * The five lists share this shape and differ only in the figure each one is sorted by, so the
 * per-list fields are optional here rather than split across five near-identical types. A list
 * carries its own figures and nothing else: a rising title has no release date, an anticipated
 * one has no score yet.
 */
export interface PulseTitle {
  id: string;
  title: string;
  title_jp?: string | null;
  title_romaji?: string | null;
  href: string;
  image_url?: string | null;
  image_sexual?: number | null;
  /** Rising and falling: the settled average, where reception sits now, and the gap. */
  baseline?: number | null;
  current_score?: number | null;
  shift?: number | null;
  /** How many votes the shift is drawn from, which is what makes it worth quoting or not. */
  window_votes?: number | null;
  /** New releases: release date, and reception so far. */
  released?: string | null;
  votes?: number | null;
  score?: number | null;
  /** Anticipated: the announced date, and how many readers are waiting on it. */
  out_on?: string | null;
  waiting?: number | null;
  /** Finishing: how many readers reached the end inside the window. */
  finishes?: number | null;
}

/** One week of reading, as the community produced it. */
export interface PulseWeek {
  week: string;
  votes: number;
  readers: number;
  new_readers: number;
}

export interface CommunityPulse {
  /** The day the figures were taken from, which is the last day the dump covers. */
  reference: string | null;
  /** Titles gaining and losing readers over the last seven days. */
  rising: PulseTitle[];
  falling: PulseTitle[];
  /** Just out, and not yet out. */
  newReleases: PulseTitle[];
  anticipated: PulseTitle[];
  /** Titles readers are reaching the end of. */
  finishing: PulseTitle[];
  /** Recent weeks, oldest first, for the shape of the line rather than its exact values. */
  weeks: PulseWeek[];
  /** This week against the one before it, which is the only comparison the figure needs. */
  votesThisWeek: number | null;
  votesLastWeek: number | null;
  readersThisWeek: number | null;
}

/** Long enough to be cheap, short enough that a daily import shows up the same day. */
const PULSE_REVALIDATE_SECONDS = 1800;

/** Matches the other server fetchers, so a backend that accepts and stalls cannot hang a render. */
const REQUEST_TIMEOUT_MS = 30000;

/** Rows pass through whole: a list's own figure travels with the title it belongs to. */
function titles(input: unknown): PulseTitle[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((row): row is PulseTitle => Boolean(row && typeof row.id === 'string' && row.href))
    .slice(0, 8);
}

/**
 * Hold every cover on this page to the front page's stricter bar.
 *
 * These lists are drawn from what people are actually reading, which includes a good deal of
 * adult work, and the front page is the one surface a visitor has not chosen to be on. The
 * swap only costs a lookup for covers over the bar, and that lookup is cached for the day.
 */
async function safen(list: PulseTitle[]): Promise<PulseTitle[]> {
  return Promise.all(
    list.map(async (row) => {
      const cover = await safeHomepageCover(row.id, row.image_url, row.image_sexual);
      return { ...row, image_url: cover.imageUrl, image_sexual: cover.imageSexual };
    }),
  );
}

export async function getCommunityPulse(): Promise<CommunityPulse | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  try {
    const res = await fetch(`${backendUrl}/api/v1/stats/global/trend-feed`, {
      next: { revalidate: PULSE_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const week = data?.shifting?.week ?? {};
    const weeks: PulseWeek[] = Array.isArray(data?.pulse)
      ? data.pulse.filter((w: PulseWeek) => w && typeof w.votes === 'number')
      : [];

    // The last entry is the newest week the dump covers, and the one before it is what a
    // reader is implicitly comparing it against.
    const latest = weeks.length > 0 ? weeks[weeks.length - 1] : null;
    const previous = weeks.length > 1 ? weeks[weeks.length - 2] : null;

    const [rising, falling, newReleases, anticipated, finishing] = await Promise.all([
      safen(titles(week.rising)),
      safen(titles(week.falling)),
      safen(titles(data?.new_releases)),
      safen(titles(data?.anticipated)),
      safen(titles(data?.finishing)),
    ]);

    const pulse: CommunityPulse = {
      reference: typeof data?.reference === 'string' ? data.reference : null,
      rising,
      falling,
      newReleases,
      anticipated,
      finishing,
      weeks,
      votesThisWeek: latest?.votes ?? null,
      votesLastWeek: previous?.votes ?? null,
      readersThisWeek: latest?.readers ?? null,
    };

    // Nothing to show is not the same as a failure, but it renders the same way: absent.
    if (pulse.rising.length === 0 && pulse.weeks.length === 0) return null;
    return pulse;
  } catch {
    return null;
  }
}

/** The last day of a seven-day window, from the ISO date of its first. */
export function weekEnd(week: string): string {
  const [year, month, day] = week.split('-').map(Number);
  const end = new Date(Date.UTC(year, month - 1, day + 6));
  // The feed emits a plain date; anything else is handed back as it came, the
  // way the labels beside it already behave.
  return Number.isNaN(end.getTime()) ? week : end.toISOString().slice(0, 10);
}
