'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { DateCalendar } from './DateCalendar';
import { fetchNewsDates, TAB_SLUGS, type NewsDateInfo } from '@/lib/sample-news-data';
import { skipNextScroll } from '@/components/ScrollToTop';

interface DateStripProps {
  currentDate: string; // YYYY-MM-DD
  tab: string;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

/** Get the Monday of the week containing the given date */
function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ...
  const diff = day === 0 ? -6 : 1 - day; // Shift to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function formatDayLabel(dateStr: string): { weekday: string; day: string; month: string } {
  const d = new Date(dateStr + 'T00:00:00');
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    day: d.getDate().toString(),
    month: d.toLocaleDateString('en-US', { month: 'short' }),
  };
}

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DateStrip({ currentDate, tab }: DateStripProps) {
  const router = useRouter();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());

  const today = getToday();

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
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {weekLabel}
        </span>
        <div className="flex items-center gap-1.5">
          {!isToday && (
            <Link
              href={`/news/${tab}/`}
              onClick={skipNextScroll}
              className="px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
            >
              Today
            </Link>
          )}
          <div className="relative">
            <button
              onClick={() => setCalendarOpen(!calendarOpen)}
              className={`p-1.5 rounded-md transition-colors ${
                calendarOpen
                  ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              aria-label="Open calendar"
            >
              <Calendar className="w-4 h-4" />
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
        <button
          onClick={goToPrevWeek}
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
          aria-label="Previous week"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Day pills — fixed Mon-Sun positions */}
        <div className="flex gap-1 flex-1 justify-center">
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
                className={`
                  relative flex flex-col items-center px-1.5 sm:px-2.5 py-1.5 rounded-lg text-xs transition-all min-w-0 flex-1
                  ${isSelected
                    ? 'bg-rose-500 text-white shadow-xs shadow-rose-500/20'
                    : isFuture
                      ? 'text-gray-300 dark:text-gray-600 cursor-default'
                      : isCurrentToday
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                `}
              >
                <span className={`text-[10px] font-medium ${
                  isSelected ? 'text-rose-200' : isFuture ? '' : isCurrentToday ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'
                }`}>
                  {weekday}
                </span>
                <span className={`text-sm font-semibold leading-tight ${isSelected ? 'text-white' : ''}`}>
                  {day}
                </span>
                <span className={`text-[10px] ${
                  isSelected ? 'text-rose-200' : isFuture ? '' : isCurrentToday ? 'text-blue-400 dark:text-blue-500' : 'text-gray-400 dark:text-gray-500'
                }`}>
                  {month}
                </span>
                {/* Content dot */}
                {hasContent && !isSelected && !isFuture && (
                  <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-rose-400" />
                )}
              </Link>
            );
          })}
        </div>

        <button
          onClick={goToNextWeek}
          disabled={!canGoForward}
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          aria-label="Next week"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
