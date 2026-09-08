import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { formatLongDate } from '@/lib/news';
import { OUT_NOW_DAYS, type OutNowDay } from '@/lib/out-now';
import { OutNowRow } from './OutNowRow';

/** Release days open on the page; the rest of the window sits behind a fold. */
const OPEN_DAYS = 7;

/**
 * The page's spine: what has come out over the out-now window, a rule per day and the
 * titles of that day under it, newest day first. The most recent days stand open and the
 * earlier ones fold, so a full month does not push the doujin grid off the first screens.
 */
export function OutNow({ locale, days }: { locale: Locale; days: OutNowDay[] }) {
  if (days.length === 0) return null;
  const open = days.slice(0, OPEN_DAYS);
  const earlier = days.slice(OPEN_DAYS);
  const dayBlock = (day: OutNowDay) => (
    <div key={day.date} className="nw-sched-day">
      <h4 className="rel-group-title">{formatLongDate(day.date, locale)}</h4>
      <ul className="nw-sched-grid">
        {day.entries.map((entry) => (
          <OutNowRow key={entry.key} entry={entry} />
        ))}
      </ul>
    </div>
  );
  return (
    <section className="nw-sched" aria-labelledby="rel-out">
      <div className="nw-group">
        <h3 id="rel-out" className="nw-group-title">
          {ns(locale, 'rel.outNow')}
        </h3>
        <span className="nw-block-sub">{ns(locale, 'rel.outNow.sub', { days: OUT_NOW_DAYS })}</span>
      </div>
      {open.map(dayBlock)}
      {earlier.length > 0 && (
        <details className="nw-sched-more">
          <summary className="nw-step">
            {ns(locale, 'rel.earlier', { n: earlier.reduce((sum, day) => sum + day.entries.length, 0) })}
          </summary>
          {earlier.map(dayBlock)}
        </details>
      )}
    </section>
  );
}
