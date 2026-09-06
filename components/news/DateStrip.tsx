'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from '@/components/Link';
import { useRouter } from 'next/navigation';
import { DateCalendar } from './DateCalendar';
import { fetchNewsDates, TAB_SLUGS, type NewsDateInfo } from '@/lib/sample-news-data';
import { skipNextScroll } from '@/components/ScrollToTop';

interface DateStripProps {
  currentDate: string; // YYYY-MM-DD
  tab: string;
  serverToday?: string; // YYYY-MM-DD, the day the markup was rendered for
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

/** Get the Monday of the week containing the given date */
function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ...
  const diff = day === 0 ? -6 : 1 - day; // Shift to Monday
  d.setDate(d.getDate() + diff);
  return localDateStr(d);
}

function formatDayLabel(dateStr: string): { weekday: string; day: string; month: string } {
  const d = new Date(dateStr + 'T00:00:00');
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    day: d.getDate().toString(),
    month: d.toLocaleDateString('en-US', { month: 'short' }),
  };
}

export function DateStrip({ currentDate, tab, serverToday }: DateStripProps) {
  const router = useRouter();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());

  // Which day counts as today decides whether a pill is a link and whether the Today
  // shortcut exists, so it is settled once at render and read from the clock again
  // after mount: cached markup can outlive the day it was built on. A caller that
  // knows the day the markup was built for passes it in, which keeps the first client
  // render identical to that markup. News days are filed in UTC.
  const [today, setToday] = useState(() => serverToday ?? new Date().toISOString().slice(0, 10));
  useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10));
  }, []);

  // Show the calendar week (Mon–Sun) containing the selected date
  const weekStart = useMemo(() => getWeekStart(currentDate), [currentDate]);

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  // Week label: "Feb 10 – 16, 2026" or "Feb 24 – Mar 2, 2026"
  const weekLabel = useMemo(() => {
    const start = new Date(days[0] + 'T00:00:00');
    const end = new Date(days[6] + 'T00:00:00');
    const sameMonth = start.getMonth() === end.getMonth();
    const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = sameMonth
      ? end.getDate().toString()
      : end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const year = end.getFullYear();
    return `${startStr} – ${endStr}, ${year}`;
  }, [days]);

  // Fetch available dates on mount
  useEffect(() => {
    const source = TAB_SLUGS[tab];
    fetchNewsDates({ source: source || undefined, days: 90 }).then((dates: NewsDateInfo[]) => {
      setAvailableDates(new Set(dates.map(d => d.date)));
    });
  }, [tab]);

  const goToPrevWeek = () => {
    skipNextScroll();
    router.push(`/news/${tab}/${addDays(currentDate, -7)}/`);
  };

  const goToNextWeek = () => {
    const next = addDays(currentDate, 7);
    skipNextScroll();
    router.push(`/news/${tab}/${next > today ? today : next}/`);
  };

  const isToday = currentDate === today;
  const canGoForward = days[6] < today; // Can go forward if the week's Sunday is before today

  return (
    <div className="flex flex-col gap-2">
      {/* Top row: week label + controls */}
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs tabular-nums text-[color:var(--text-secondary)]">
          {weekLabel}
        </span>
        <div className="flex items-center gap-1.5">
          {!isToday && (
            <Link href={`/news/${tab}/`} onClick={skipNextScroll} className="nw-step">
              Today
            </Link>
          )}
          <div className="relative">
            <button
              onClick={() => setCalendarOpen(!calendarOpen)}
              className={calendarOpen ? 'nw-step nw-step--on' : 'nw-step'}
              aria-label="Open calendar"
            >
              Calendar
            </button>
            {calendarOpen && (
              <DateCalendar
                currentDate={currentDate}
                availableDates={availableDates}
                onSelectDate={(date) => {
                  skipNextScroll();
                  router.push(`/news/${tab}/${date}/`);
                }}
                onClose={() => setCalendarOpen(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Bottom row: week navigation */}
      <div className="flex items-center gap-1.5">
        <button onClick={goToPrevWeek} className="nw-step shrink-0" aria-label="Previous week">
          ←
        </button>

        {/* Day pills: fixed Mon-Sun positions */}
        <div className="flex flex-1 justify-center gap-1">
          {days.map((dateStr) => {
            const isSelected = dateStr === currentDate;
            const isFuture = dateStr > today;
            const hasContent = availableDates.has(dateStr);
            const { weekday, day, month } = formatDayLabel(dateStr);
            const isCurrentToday = dateStr === today;

            return (
              <Link
                key={dateStr}
                href={isFuture ? '#' : `/news/${tab}/${dateStr}/`}
                aria-disabled={isFuture}
                onClick={isFuture ? (e) => e.preventDefault() : skipNextScroll}
                className={`nw-day${isSelected ? ' nw-day--on' : isCurrentToday ? ' nw-day--now' : ''}`}
              >
                <span className="opacity-70">{weekday}</span>
                <span className="text-[0.8125rem] font-semibold">{day}</span>
                <span className="opacity-70">{month}</span>
                {/* A day the aggregator filed something for */}
                {hasContent && !isSelected && !isFuture && (
                  <span className="absolute right-[3px] top-[3px] h-1 w-1 bg-[color:var(--kohaku)]" />
                )}
              </Link>
            );
          })}
        </div>

        <button
          onClick={goToNextWeek}
          disabled={!canGoForward}
          className="nw-step shrink-0"
          aria-label="Next week"
        >
          →
        </button>
      </div>
    </div>
  );
}
