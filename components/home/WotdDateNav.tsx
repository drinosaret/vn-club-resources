'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function WotdCalendar({
  currentDate,
  maxDate,
  onSelectDate,
  onClose,
}: {
  currentDate: string;
  maxDate: string;
  onSelectDate: (date: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [year, month] = currentDate.split('-').map(Number);
  const [viewYear, setViewYear] = useState(year);
  const [viewMonth, setViewMonth] = useState(month - 1);

  const [maxYear, maxMonthRaw] = maxDate.split('-').map(Number);
  const maxMonth0 = maxMonthRaw - 1; // 0-indexed

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const isNextDisabled = viewYear === maxYear && viewMonth >= maxMonth0;

  const goToPrevMonth = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); }
    else setViewMonth(viewMonth - 1);
  };

  const goToNextMonth = () => {
    if (isNextDisabled) return;
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); }
    else setViewMonth(viewMonth + 1);
  };

  return (
    <div
      ref={ref}
      className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 w-[280px]"
    >
      <div className="flex items-center justify-between mb-2">
        <button onClick={goToPrevMonth} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" aria-label="Previous month">
          <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        </button>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          {new Date(viewYear, viewMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button onClick={goToNextMonth} disabled={isNextDisabled} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Next month">
          <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-gray-400 dark:text-gray-500 py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateStr = formatDateStr(viewYear, viewMonth, day);
          const isSelected = dateStr === currentDate;
          const isTodayCal = dateStr === maxDate;
          const isFutureCal = dateStr > maxDate;

          return (
            <button
              key={day}
              onClick={() => { if (!isFutureCal) { onSelectDate(dateStr); onClose(); } }}
              disabled={isFutureCal}
              className={`
                flex items-center justify-center w-full aspect-square rounded-lg text-sm transition-all
                ${isSelected
                  ? 'bg-emerald-500 text-white font-semibold'
                  : isTodayCal
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-medium'
                    : isFutureCal
                      ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }
              `}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function dateHref(date: string): string {
  return `/word-of-the-day?date=${date}`;
}

export function WotdDateNav({ currentDate, latestDate }: { currentDate: string; latestDate?: string }) {
  const router = useRouter();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const maxDate = latestDate || currentDate;
  const isLatest = currentDate >= maxDate;
  const prevDate = addDays(currentDate, -1);
  const nextDate = addDays(currentDate, 1);

  const formattedDate = new Date(currentDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  function goTo(date: string) {
    router.push(`/word-of-the-day?date=${date}`);
  }

  return (
    <>
    <div className="relative flex items-center justify-between gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
      {/* Prev day */}
      <Link
        href={dateHref(prevDate)}
        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        aria-label="Previous day"
      >
        <ChevronLeft className="w-5 h-5" />
      </Link>

      {/* Date display + calendar toggle */}
      <button
        onClick={() => setCalendarOpen(!calendarOpen)}
        className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <Calendar className="w-4 h-4 text-gray-400 dark:text-gray-500" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {formattedDate}
        </span>
      </button>

      {/* Next day */}
      {isLatest ? (
        <span
          className="p-1.5 rounded-lg opacity-30 cursor-not-allowed text-gray-500 dark:text-gray-400"
          aria-label="Next day"
        >
          <ChevronRight className="w-5 h-5" />
        </span>
      ) : (
        <Link
          href={dateHref(nextDate)}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          aria-label="Next day"
        >
          <ChevronRight className="w-5 h-5" />
        </Link>
      )}

      {/* Calendar dropdown */}
      {calendarOpen && (
        <WotdCalendar
          currentDate={currentDate}
          maxDate={maxDate}
          onSelectDate={goTo}
          onClose={() => setCalendarOpen(false)}
        />
      )}
    </div>
    {!isLatest && (
      <div className="text-center mt-2">
        <Link
          href="/word-of-the-day"
          className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:underline transition-colors"
        >
          Jump to today&rsquo;s word
        </Link>
      </div>
    )}
    </>
  );
}
