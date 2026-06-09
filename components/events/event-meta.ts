// Shared presentation metadata for calendar event types.
import type { LucideIcon } from 'lucide-react';
import { Sparkles, Leaf, Film, CalendarDays, Vote, Sprout, PartyPopper, Cake } from 'lucide-react';

export interface EventMeta {
  label: string;
  Icon: LucideIcon;
  dot: string; // small colored dot
  chip: string; // chip background + text
  accent: string; // left border accent for list rows
}

export const EVENT_META: Record<string, EventMeta> = {
  vn_of_month: {
    label: 'VN of the Month',
    Icon: Sparkles,
    dot: 'bg-indigo-500',
    chip: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200',
    accent: 'border-indigo-400',
  },
  vn_of_season: {
    label: 'VN of the Season',
    Icon: Leaf,
    dot: 'bg-purple-500',
    chip: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-200',
    accent: 'border-purple-400',
  },
  vn_month_voting: {
    label: 'VN of the Month Voting',
    Icon: Vote,
    dot: 'bg-amber-500',
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
    accent: 'border-amber-400',
  },
  vn_season_voting: {
    label: 'VN of the Season Voting',
    Icon: Vote,
    dot: 'bg-sky-500',
    chip: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
    accent: 'border-sky-400',
  },
  movie_night: {
    label: 'Movie Night',
    Icon: Film,
    dot: 'bg-rose-500',
    chip: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
    accent: 'border-rose-400',
  },
  custom: {
    label: 'Event',
    Icon: CalendarDays,
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
    accent: 'border-emerald-400',
  },
  season_start: {
    label: 'Season start',
    Icon: Sprout,
    dot: 'bg-teal-500',
    chip: 'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200',
    accent: 'border-teal-400',
  },
  holiday: {
    label: 'Holiday',
    Icon: PartyPopper,
    dot: 'bg-gray-400',
    chip: 'bg-gray-100 text-gray-500 dark:bg-gray-700/40 dark:text-gray-400',
    accent: 'border-gray-300',
  },
  anniversary: {
    label: 'Anniversary',
    Icon: Cake,
    dot: 'bg-yellow-500',
    chip: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-200',
    accent: 'border-yellow-400',
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
