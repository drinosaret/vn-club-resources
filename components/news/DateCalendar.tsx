'use client';

import { useState, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface DateCalendarProps {
  currentDate: string; // YYYY-MM-DD
  availableDates?: Set<string>;
  onSelectDate: (date: string) => void;
  onClose: () => void;
  /**
   * The control that opened the calendar. A press on it is not a click outside: the
   * control toggles the calendar itself, and closing it here first would reopen it.
   */
  anchorRef?: RefObject<HTMLElement | null>;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function DateCalendar({ currentDate, availableDates, onSelectDate, onClose, anchorRef }: DateCalendarProps) {
  const ref = useRef<HTMLDivElement>(null);
  // The panel hangs off the control's left edge unless that would run past the viewport,
  // in which case it hangs off the right: the control can sit at either end of a row.
  const [alignRight, setAlignRight] = useState(false);
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect && rect.right > window.innerWidth) setAlignRight(true);
  }, []);
  const [year, month] = currentDate.split('-').map(Number);
  const [viewYear, setViewYear] = useState(year);
  const [viewMonth, setViewMonth] = useState(month - 1); // 0-indexed

  const today = new Date();
  const todayStr = formatDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (anchorRef?.current?.contains(target)) return;
      if (ref.current && !ref.current.contains(target)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose, anchorRef]);

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
    // The archive has nothing after the current month.
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
    <div ref={ref} className={`absolute top-full z-50 mt-2 w-[280px] ${alignRight ? 'right-0' : 'left-0'}`}>
      <div className="panel p-3">
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

        <div className="grid grid-cols-7 gap-0.5">
          {/* Pads the first row so day 1 lands on its weekday column. */}
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
