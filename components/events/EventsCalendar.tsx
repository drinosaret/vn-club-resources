'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { EventItem } from '@/lib/events';
import { eventMeta, formatTime } from './event-meta';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { NSFWImage } from '@/components/NSFWImage';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import DayOverview from './DayOverview';

// /vn/123/ -> "v123", for per-VN NSFW reveal persistence.
function vnIdFromUrl(url: string | null): string | undefined {
  const m = url?.match(/^\/vn\/(\d+)\/?$/);
  return m ? `v${m[1]}` : undefined;
}

// Week starts on Sunday.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY = 86_400_000;
// These span a whole month/season, so they render as banners below the grid
// instead of as a bar across every week.
const BANNER_TYPES = new Set(['vn_of_month', 'vn_of_season']);

// Render a description, turning any mention of "Discord" into a link to the join
// page (these events all happen in the Discord server).
function renderDescription(text: string) {
  return text.split(/(\bDiscord\b)/gi).map((part, i) =>
    /^Discord$/i.test(part) ? (
      <Link
        key={i}
        href="/join"
        className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        {part}
      </Link>
    ) : (
      part
    ),
  );
}

interface Props {
  initialYear: number;
  initialMonth: number; // 1-12
  initialEvents: EventItem[];
  initialSelectedDate?: string | null; // YYYY-MM-DD: auto-open this day's overview
}

async function fetchMonth(year: number, month: number): Promise<EventItem[]> {
  const base = process.env.NEXT_PUBLIC_VNDB_STATS_API;
  if (!base) return [];
  try {
    const res = await fetch(`${base}/api/v1/events?year=${year}&month=${month}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.events ?? [];
  } catch {
    return [];
  }
}

function adjMonth(year: number, month: number, delta: number): [number, number] {
  const m = month + delta;
  if (m < 1) return [year - 1, 12];
  if (m > 12) return [year + 1, 1];
  return [year, m];
}

function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function whenLabel(e: EventItem): string {
  if (e.all_day) {
    return e.end_at ? `${dateLabel(e.start_at)} – ${dateLabel(e.end_at)}` : dateLabel(e.start_at);
  }
  return `${dateLabel(e.start_at)} · ${formatTime(e.start_at)}`;
}

// UTC day-granularity start/end (inclusive) for grid placement.
function eventRange(e: EventItem): [number, number] {
  const s = new Date(e.start_at);
  const start = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  let end = start;
  if (e.end_at) {
    const en = new Date(e.end_at);
    end = Date.UTC(en.getUTCFullYear(), en.getUTCMonth(), en.getUTCDate());
  }
  return [start, Math.max(start, end)];
}

interface Bar {
  e: EventItem;
  startCol: number;
  span: number;
  lane: number;
  clipLeft: boolean;
  clipRight: boolean;
}

// Assign each overlapping event a column span + a non-overlapping lane for one week.
function layoutWeek(weekStartMs: number, events: EventItem[]): Bar[] {
  const weekEndMs = weekStartMs + 6 * DAY;
  const inWeek = events
    .map((e) => ({ e, r: eventRange(e) }))
    .filter(({ r }) => r[0] <= weekEndMs && r[1] >= weekStartMs)
    .sort((a, b) => a.r[0] - b.r[0] || b.r[1] - b.r[0] - (a.r[1] - a.r[0]));

  const lanes: Array<Array<[number, number]>> = [];
  const bars: Bar[] = [];
  for (const { e, r } of inWeek) {
    const startCol = Math.max(0, Math.round((r[0] - weekStartMs) / DAY));
    const endCol = Math.min(6, Math.round((r[1] - weekStartMs) / DAY));
    let lane = 0;
    while (true) {
      const occ = lanes[lane];
      if (!occ) {
        lanes[lane] = [[startCol, endCol]];
        break;
      }
      if (occ.every(([os, oe]) => endCol < os || startCol > oe)) {
        occ.push([startCol, endCol]);
        break;
      }
      lane++;
    }
    bars.push({
      e,
      startCol,
      span: endCol - startCol + 1,
      lane,
      clipLeft: r[0] < weekStartMs,
      clipRight: r[1] > weekEndMs,
    });
  }
  return bars;
}

export default function EventsCalendar({
  initialYear,
  initialMonth,
  initialEvents,
  initialSelectedDate,
}: Props) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [events, setEvents] = useState<EventItem[]>(initialEvents);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<EventItem | null>(null);
  const [overviewDay, setOverviewDay] = useState<Date | null>(null);
  const { preference } = useTitlePreference();
  const dtitle = (e: EventItem) =>
    getDisplayTitle(
      { title: e.title, title_jp: e.title_jp ?? undefined, title_romaji: e.title_romaji ?? undefined },
      preference,
    );
  // "Today" is keyed to UTC to match the grid (which places every day by its UTC
  // date), so the highlight lands on the same cell the events are placed against.
  // Set after mount so SSR and client agree (avoids a hydration mismatch).
  const [todayParts, setTodayParts] = useState<{ y: number; mo: number; d: number } | null>(null);
  useEffect(() => {
    const n = new Date();
    setTodayParts({ y: n.getUTCFullYear(), mo: n.getUTCMonth(), d: n.getUTCDate() });
  }, []);

  // Arriving via a ?date=YYYY-MM-DD deep link opens that day's overview on load.
  useEffect(() => {
    if (initialSelectedDate && /^\d{4}-\d{2}-\d{2}$/.test(initialSelectedDate)) {
      const [y, m, d] = initialSelectedDate.split('-').map(Number);
      setOverviewDay(new Date(Date.UTC(y, m - 1, d)));
    }
  }, [initialSelectedDate]);

  // Month cache (seeded with the SSR month) so revisiting a month is instant.
  const cacheRef = useRef<Map<string, EventItem[]>>(
    new Map([[`${initialYear}-${initialMonth}`, initialEvents]]),
  );

  // Swap in cached months immediately (no flash); fetch only uncached ones, and
  // prefetch the adjacent months so prev/next is instant.
  useEffect(() => {
    let active = true;
    const key = `${year}-${month}`;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setEvents(cached);
      setLoading(false);
    } else {
      setLoading(true);
      fetchMonth(year, month)
        .then((rows) => {
          cacheRef.current.set(key, rows);
          if (active) setEvents(rows);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    for (const [ny, nm] of [adjMonth(year, month, -1), adjMonth(year, month, 1)]) {
      const k = `${ny}-${nm}`;
      if (!cacheRef.current.has(k)) {
        fetchMonth(ny, nm)
          .then((rows) => cacheRef.current.set(k, rows))
          .catch(() => {});
      }
    }
    return () => {
      active = false;
    };
  }, [year, month]);

  const go = useCallback(
    (delta: number) => {
      // Compute both values then set them; never call setYear inside the setMonth
      // updater (StrictMode double-invokes updaters, double-stepping the year).
      const [ny, nm] = adjMonth(year, month, delta);
      setYear(ny);
      setMonth(nm);
    },
    [year, month],
  );

  const today = () => {
    const now = new Date();
    setYear(now.getUTCFullYear());
    setMonth(now.getUTCMonth() + 1);
  };

  // Build the weeks (Monday-first), padding into adjacent months.
  const monthIdx = month - 1;
  const firstDow = new Date(Date.UTC(year, monthIdx, 1)).getUTCDay(); // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const numWeeks = Math.ceil((firstDow + daysInMonth) / 7);
  const gridStartMs = Date.UTC(year, monthIdx, 1) - firstDow * DAY;
  const weeks = Array.from({ length: numWeeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => new Date(gridStartMs + (w * 7 + d) * DAY)),
  );

  // Prefer the cached month during render so a cached month paints correctly on
  // the first frame (the effect's setEvents lands a frame later).
  const shownEvents = cacheRef.current.get(`${year}-${month}`) ?? events;

  // Month/season picks become banners below the grid; everything else (movie
  // nights, voting windows, custom events) stays on the grid.
  const gridEvents = shownEvents.filter((e) => !BANNER_TYPES.has(e.event_type));
  const monthPicks = shownEvents.filter((e) => BANNER_TYPES.has(e.event_type));

  // Label each event only on its first week within this month's grid, so a
  // multi-week (or multi-month, e.g. a season) bar reads as one event and still
  // shows its title in every month it spans.
  const labeledIds = new Set<number>();

  const isTodayCell = (d: Date) =>
    !!todayParts &&
    d.getUTCFullYear() === todayParts.y &&
    d.getUTCMonth() === todayParts.mo &&
    d.getUTCDate() === todayParts.d;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {monthLabel(year, month)}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={today}
            className="mr-1 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous month"
            className="rounded-md border border-gray-200 p-1.5 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next month"
            className="rounded-md border border-gray-200 p-1.5 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-800/20">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
            >
              {d}
            </div>
          ))}
        </div>

        {weeks.map((days, wi) => {
          const weekStartMs = Date.UTC(
            days[0].getUTCFullYear(),
            days[0].getUTCMonth(),
            days[0].getUTCDate(),
          );
          const bars = layoutWeek(weekStartMs, gridEvents);

          return (
            <div
              key={wi}
              className="relative min-h-[92px] border-b border-gray-200 last:border-b-0 dark:border-gray-800"
            >
              {/* Cell backdrop: full-height column dividers + out-of-month/today tints,
                  behind the day numbers and bars (which are positioned above). */}
              <div className="pointer-events-none absolute inset-0 grid grid-cols-7">
                {days.map((d, i) => {
                  const inMonth = d.getUTCMonth() === monthIdx;
                  // Out-of-month days recede; today is marked by its number, not a fill.
                  const tint = !inMonth ? 'bg-gray-50 dark:bg-gray-950' : '';
                  return (
                    <div
                      key={i}
                      className={`${i < 6 ? 'border-r border-gray-200 dark:border-gray-800' : ''} ${tint}`}
                    />
                  );
                })}
              </div>

              {/* day numbers */}
              <div className="relative grid grid-cols-7">
                {days.map((d) => {
                  const inMonth = d.getUTCMonth() === monthIdx;
                  const dMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
                  return (
                    <button
                      key={dMs}
                      type="button"
                      onClick={() => setOverviewDay(d)}
                      title="Day overview"
                      className="group flex w-full justify-start px-1.5 pt-1.5 text-left"
                    >
                      <span
                        className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs transition-colors ${
                          isTodayCell(d)
                            ? 'bg-indigo-600 font-semibold text-white'
                            : inMonth
                              ? 'text-gray-700 group-hover:bg-gray-200 dark:text-gray-200 dark:group-hover:bg-gray-700'
                              : 'text-gray-300 group-hover:bg-gray-100 dark:text-gray-600 dark:group-hover:bg-gray-800'
                        }`}
                      >
                        {d.getUTCDate()}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* event bars: span days via grid columns, stack via grid rows (lanes).
                  Rows grow (minmax) so wrapped mobile titles aren't clipped; on
                  desktop the single-line bars keep the row at its 1.25rem minimum. */}
              <div
                className="relative grid grid-cols-7 gap-y-0.5 pb-1 pt-1"
                style={{ gridAutoRows: 'minmax(1.25rem, auto)' }}
              >
                {bars.map((b) => {
                  const meta = eventMeta(b.e.event_type);
                  const showLabel = !labeledIds.has(b.e.id);
                  if (showLabel) labeledIds.add(b.e.id);
                  const t = dtitle(b.e);
                  const rounding = `${b.clipLeft ? 'rounded-l-none' : ''} ${b.clipRight ? 'rounded-r-none' : ''}`;
                  // A single-day cell is too narrow (~38px on a phone) for an inline
                  // icon beside the title, so on mobile the icon sits above a
                  // full-width wrapping title; multi-day bars have room to keep it
                  // inline. Titles wrap to 2 lines on every size (no cut-off).
                  const layout =
                    b.span === 1
                      ? 'flex-col items-center justify-center gap-0.5 text-center sm:flex-row sm:justify-start sm:gap-1 sm:text-left'
                      : 'flex-row items-center gap-1 text-left';
                  const cell = {
                    gridColumn: `${b.startCol + 1} / span ${b.span}`,
                    gridRow: b.lane + 1,
                  };
                  return (
                    <Fragment key={`${b.e.id}-${wi}`}>
                      {/* Opaque backdrop so the full-height grid dividers behind the row
                          don't bleed through a translucent dark-mode chip; the chip then
                          reads as a solid band over the grid. */}
                      <span
                        aria-hidden
                        className={`pointer-events-none rounded bg-white dark:bg-gray-900 ${rounding}`}
                        style={cell}
                      />
                      <button
                        type="button"
                        onClick={() => setSelected(b.e)}
                        title={t}
                        aria-label={t}
                        className={`flex min-h-5 overflow-hidden rounded px-1 py-0.5 text-[10px] font-medium ${meta.chip} ${rounding} ${layout} hover:brightness-95 sm:px-1.5`}
                        style={cell}
                      >
                        {/* Only the first week of a multi-week bar is labeled;
                            later weeks are unlabeled colored continuations. */}
                        {showLabel && <meta.Icon className="h-3 w-3 shrink-0" />}
                        {/* Title wraps to as many lines as it needs (no line cap) so even
                            long single-day titles like "Labor Thanksgiving Day" are never
                            cut off. Time is omitted from the bar; it's in the day overview
                            + detail modal. */}
                        <span className="block w-full min-w-0 break-words leading-tight">
                          {showLabel ? t : ''}
                        </span>
                      </button>
                    </Fragment>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {monthPicks.length > 0 && (
        <div className="mt-3 space-y-2">
          {monthPicks.map((e) => {
            const meta = eventMeta(e.event_type);
            const name = dtitle(e).replace(/^VN of the (Month|Season): /, '');
            const cover = e.cover_url || e.image_url;
            const inner = (
              <div
                className={`flex items-center gap-3 rounded-lg border border-gray-200 border-l-4 ${meta.accent} bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800/50`}
              >
                {cover ? (
                  <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
                    <NSFWImage
                      src={getProxiedImageUrl(cover, { width: 128 }) || cover}
                      alt=""
                      imageSexual={e.image_sexual}
                      vnId={vnIdFromUrl(e.url)}
                      className="h-full w-full object-cover"
                      compact
                    />
                  </div>
                ) : (
                  <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-gray-100 dark:bg-gray-800">
                    <meta.Icon className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.chip}`}>
                    {meta.label}
                  </span>
                  <p className="mt-0.5 truncate font-medium text-gray-900 dark:text-gray-100">{name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{whenLabel(e)}</p>
                </div>
              </div>
            );
            return <div key={e.id}>{e.url ? <Link href={e.url}>{inner}</Link> : inner}</div>;
          })}
        </div>
      )}

      {loading && (
        <p className="mt-2 text-center text-xs text-gray-400 dark:text-gray-500">Loading…</p>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${eventMeta(selected.event_type).chip}`}
              >
                {eventMeta(selected.event_type).label}
              </span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {(selected.cover_url || selected.image_url) && (
              <div className="relative mb-2 h-32 w-full overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
                <NSFWImage
                  src={
                    getProxiedImageUrl(selected.cover_url || selected.image_url, { width: 256 }) ||
                    selected.cover_url ||
                    selected.image_url ||
                    ''
                  }
                  alt=""
                  imageSexual={selected.image_sexual}
                  vnId={vnIdFromUrl(selected.url)}
                  className="h-full w-full object-cover"
                />
              </div>
            )}
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">{dtitle(selected)}</h3>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {whenLabel(selected)}
              {selected.location ? ` · ${selected.location}` : ''}
            </p>
            {selected.description && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                {renderDescription(selected.description)}
              </p>
            )}
            {selected.url && (
              <Link
                href={selected.url}
                className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                View details →
              </Link>
            )}
          </div>
        </div>
      )}

      {overviewDay && (
        <DayOverview
          date={overviewDay}
          events={shownEvents.filter((e) => {
            const [s, en] = eventRange(e);
            const dms = Date.UTC(
              overviewDay.getUTCFullYear(),
              overviewDay.getUTCMonth(),
              overviewDay.getUTCDate(),
            );
            return s <= dms && en >= dms;
          })}
          onClose={() => setOverviewDay(null)}
        />
      )}
    </section>
  );
}
