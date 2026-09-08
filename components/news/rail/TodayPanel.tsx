import type { NewsItem } from '@/lib/news';
import { newsPath } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { ReleaseRow } from '../ReleaseRow';
import { RailPanel } from './RailPanel';

/** What comes out today and tomorrow, as VNDB and the stores record it. */
export function TodayPanel({
  locale,
  today,
  tomorrow,
}: {
  locale: Locale;
  today: NewsItem[];
  tomorrow: NewsItem[];
}) {
  if (today.length === 0 && tomorrow.length === 0) return null;
  return (
    <RailPanel
      plate={ns(locale, 'rail.outNow')}
      href={newsPath(locale, '/news/releases/')}
      hrefLabel={ns(locale, 'rail.outNow.more')}
      hideNarrow
    >
      {today.length > 0 && (
        <>
          <p className="nw-rail-sub">{ns(locale, 'rail.today')}</p>
          <ul className="nw-release-list">
            {today.map((item) => (
              <ReleaseRow key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}
      {tomorrow.length > 0 && (
        <>
          <p className="nw-rail-sub">{ns(locale, 'rail.tomorrow')}</p>
          <ul className="nw-release-list">
            {tomorrow.map((item) => (
              <ReleaseRow key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}
    </RailPanel>
  );
}
