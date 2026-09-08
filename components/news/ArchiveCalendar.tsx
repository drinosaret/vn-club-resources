'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DateCalendar } from './DateCalendar';
import { ALL_SLUG, fetchNewsDates, newsPath, utcToday } from '@/lib/news';
import { useLocale } from '@/lib/i18n/locale-context';
import { ns } from '@/lib/i18n/translations/news';
import { skipNextScroll } from '@/components/ScrollToTop';

/**
 * The way into the day archive: a month grid behind one control.
 *
 * The front page files under the all-sections slug, so its archive shows every section
 * of a day; a section page's archive shows that section only.
 */
export function ArchiveCalendar({
  section,
  currentDate,
  compact = false,
}: {
  section: string;
  currentDate?: string;
  /** Beside the tabs the row is the frame, so the label and the rule above go. */
  compact?: boolean;
}) {
  const router = useRouter();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [today, setToday] = useState(currentDate ?? utcToday());

  useEffect(() => {
    setToday((d) => currentDate ?? (d || utcToday()));
  }, [currentDate]);

  useEffect(() => {
    if (!open || dates.size > 0) return;
    fetchNewsDates(90).then((rows) => setDates(new Set(rows.map((r) => r.date))));
  }, [open, dates.size]);

  const archiveSlug = section === 'front' ? ALL_SLUG : section;

  return (
    <div className={compact ? 'nw-archive nw-archive--compact' : 'nw-archive'}>
      {!compact && <span className="nw-archive-label">{ns(locale, 'archive.label')}</span>}
      <div className="relative">
        <button
          type="button"
          ref={toggleRef}
          onClick={() => setOpen((o) => !o)}
          className={open ? 'nw-step nw-step--on' : 'nw-step'}
          aria-expanded={open}
        >
          {ns(locale, 'archive.browse')}
        </button>
        {open && (
          <DateCalendar
            currentDate={today}
            availableDates={dates}
            onSelectDate={(date) => {
              skipNextScroll();
              setOpen(false);
              router.push(newsPath(locale, `/news/${archiveSlug}/${date}/`));
            }}
            onClose={() => setOpen(false)}
            anchorRef={toggleRef}
          />
        )}
      </div>
      <a href="/feed.xml" className="nw-archive-feed">
        {ns(locale, 'archive.rss')}
      </a>
    </div>
  );
}
