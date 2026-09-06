'use client';

import { useState, useEffect, useRef } from 'react';

interface DateCalendarProps {
  currentDate: string; // YYYY-MM-DD
  availableDates?: Set<string>;
  onSelectDate: (date: string) => void;
  onClose: () => void;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function DateCalendar({ currentDate, availableDates, onSelectDate, onClose }: DateCalendarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [year, month] = currentDate.split('-').map(Number);
  const [viewYear, setViewYear] = useState(year);
  const [viewMonth, setViewMonth] = useState(month - 1); // 0-indexed

  const today = new Date();
  const todayStr = formatDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();

  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const goToNextMonth = () => {
    // Don't go past current month
    const now = new Date();
    if (viewYear === now.getFullYear() && viewMonth >= now.getMonth()) return;

    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const isNextDisabled = viewYear === today.getFullYear() && viewMonth >= today.getMonth();

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div ref={ref} className="absolute right-0 top-full z-50 mt-2 w-[280px]">
      <div className="panel p-3">
        {/* Month header */}
        <div className="mb-2 flex items-center justify-between">
          <button onClick={goToPrevMonth} className="nw-step" aria-label="Previous month">
            ←
          </button>
          <span className="font-display text-sm font-bold text-[color:var(--ink)]">
            {monthLabel}
          </span>
          <button
            onClick={goToNextMonth}
            disabled={isNextDisabled}
            className="nw-step"
            aria-label="Next month"
          >
            →
          </button>
        </div>

        {/* Weekday headers */}
        <div className="mb-1 grid grid-cols-7 gap-0.5">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="py-1 text-center font-mono text-[0.625rem] uppercase tracking-wider text-[color:var(--text-faint)]"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {/* Empty cells for days before the 1st */}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}

          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = formatDateStr(viewYear, viewMonth, day);
            const isSelected = dateStr === currentDate;
            const isToday = dateStr === todayStr;
            const hasContent = availableDates?.has(dateStr);
            const isFuture = new Date(dateStr) > today;

            return (
              <button
                key={day}
                onClick={() => {
                  if (!isFuture) {
                    onSelectDate(dateStr);
                    onClose();
                  }
                }}
                disabled={isFuture}
                className={`nw-cal-day${isSelected ? ' nw-cal-day--on' : isToday ? ' nw-cal-day--now' : ''}`}
              >
                {day}
                {/* A day the aggregator filed something for */}
                {hasContent && !isSelected && (
                  <span className="absolute bottom-[3px] left-1/2 h-1 w-1 -translate-x-1/2 bg-[color:var(--kohaku)]" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
