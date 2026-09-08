import type { NewsItem } from '@/lib/news';
import { newsPath } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { TrailerRow } from '../TrailerRow';
import { RailPanel } from './RailPanel';

export function TrailersPanel({ locale, items, today }: { locale: Locale; items: NewsItem[]; today: string }) {
  if (items.length === 0) return null;
  return (
    <RailPanel
      plate={ns(locale, 'rail.trailers')}
      href={newsPath(locale, '/news/trailers/')}
      hrefLabel={ns(locale, 'rail.trailers.more')}
    >
      <div className="nw-rail-trailers">
        {items.map((item) => (
          <TrailerRow key={item.id} item={item} today={today} />
        ))}
      </div>
    </RailPanel>
  );
}
