'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/components/Link';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localDateStr(d);
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
    <div ref={ref} className="wd-cal">
      <div className="flex items-center justify-between mb-2">
        <button onClick={goToPrevMonth} className="wd-step" aria-label="Previous month">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="wd-cal-month">
          {new Date(viewYear, viewMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button
          onClick={goToNextMonth}
          disabled={isNextDisabled}
          className={isNextDisabled ? 'wd-step wd-step--off' : 'wd-step'}
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="wd-cal-dow">{d}</div>
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
              className={`wd-cal-day ${
                isSelected
                  ? 'wd-cal-day--on'
                  : isTodayCal
                    ? 'wd-cal-day--now'
                    : isFutureCal
                      ? 'wd-cal-day--off'
                      : ''
              }`}
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
    router.push(`/word-of-the-day/?date=${date}`);
  }

  return (
    <>
    <div className="wd-nav">
      {/* Prev day */}
      <Link href={dateHref(prevDate)} className="wd-step" aria-label="Previous day">
        <ChevronLeft className="w-5 h-5" />
      </Link>

      {/* Date display + calendar toggle */}
      <button onClick={() => setCalendarOpen(!calendarOpen)} className="wd-step">
        <Calendar className="w-4 h-4" />
        <span className="wd-date">
          {formattedDate}
        </span>
      </button>

      {/* Next day */}
      {isLatest ? (
        <button type="button" disabled className="wd-step wd-step--off" aria-label="Next day">
          <ChevronRight className="w-5 h-5" />
        </button>
      ) : (
        <Link href={dateHref(nextDate)} className="wd-step" aria-label="Next day">
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
        <Link href="/word-of-the-day/" className="sec-more wd-focus">
          Jump to today&rsquo;s word
          <span aria-hidden> →</span>
        </Link>
      </div>
    )}
    </>
  );
}
