// Shared presentation metadata for calendar event types.
import type { LucideIcon } from 'lucide-react';
import { Sparkles, Leaf, Film, BookOpen, CalendarDays, Vote, Sprout, PartyPopper, Cake } from 'lucide-react';

export interface EventMeta {
  label: string;
  /** Drawn only where a cell is too narrow for the label, or where a cover is absent. */
  Icon: LucideIcon;
  /** Label chip variant, `.ev-tag` family. */
  chip: string;
  /** Month-grid bar variant, `.ev-bar` family. */
  bar: string;
}

/**
 * One look per kind of thing, not per group of them.
 *
 * The colour is what tells a reader at a glance whether a day holds a film night or a reading,
 * so two kinds that share a shape must not share a colour. The label is always present as well,
 * since colour alone is not a way to carry meaning.
 */
const MONTH = { chip: 'ev-tag ev-tag--month', bar: 'ev-bar ev-bar--month' };
const SEASON = { chip: 'ev-tag ev-tag--season', bar: 'ev-bar ev-bar--season' };
const VOTING = { chip: 'ev-tag ev-tag--voting', bar: 'ev-bar ev-bar--voting' };
const MOVIE = { chip: 'ev-tag ev-tag--movie', bar: 'ev-bar ev-bar--movie' };
const ROUDOKU = { chip: 'ev-tag ev-tag--roudoku', bar: 'ev-bar ev-bar--roudoku' };
const SESSION = { chip: 'ev-tag ev-tag--session', bar: 'ev-bar ev-bar--session' };
const MARK = { chip: 'ev-tag ev-tag--mark', bar: 'ev-bar ev-bar--mark' };

export const EVENT_META: Record<string, EventMeta> = {
  vn_of_month: {
    label: 'VN of the Month',
    Icon: Sparkles,
    ...MONTH,
  },
  vn_of_season: {
    label: 'VN of the Season',
    Icon: Leaf,
    ...SEASON,
  },
  vn_month_voting: {
    label: 'VN of the Month Voting',
    Icon: Vote,
    ...VOTING,
  },
  vn_season_voting: {
    label: 'VN of the Season Voting',
    Icon: Vote,
    ...VOTING,
  },
  movie_night: {
    label: 'Movie Night',
    Icon: Film,
    ...MOVIE,
  },
  roudoku: {
    label: 'Weekly Roudoku',
    Icon: BookOpen,
    ...ROUDOKU,
  },
  custom: {
    label: 'Event',
    Icon: CalendarDays,
    ...SESSION,
  },
  season_start: {
    label: 'Season start',
    Icon: Sprout,
    ...MARK,
  },
  holiday: {
    label: 'Holiday',
    Icon: PartyPopper,
    ...MARK,
  },
  anniversary: {
    label: 'Anniversary',
    Icon: Cake,
    ...MARK,
  },
};

export function eventMeta(type: string): EventMeta {
  return EVENT_META[type] ?? EVENT_META.custom;
}

// Grid placement and display both key off the UTC calendar date, so a calendar
// configured in UTC reads identically regardless of the viewer's timezone.
export function utcDate(iso: string): { year: number; month: number; day: number } {
  const d = new Date(iso);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function isMultiDay(e: { start_at: string; end_at: string | null }): boolean {
  if (!e.end_at) return false;
  const s = utcDate(e.start_at);
  const en = utcDate(e.end_at);
  return s.year !== en.year || s.month !== en.month || s.day !== en.day;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
