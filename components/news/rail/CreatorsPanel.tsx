import type { NewsItem } from '@/lib/news';
import { newsPath } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { LineRow } from '../LineRow';
import { RailPanel } from './RailPanel';

/** The latest from the writers, artists and singers on their own accounts. */
export function CreatorsPanel({ locale, items }: { locale: Locale; items: NewsItem[] }) {
  if (items.length === 0) return null;
  return (
    <RailPanel
      plate={ns(locale, 'rail.creators')}
      href={newsPath(locale, '/news/creators/')}
      hrefLabel={ns(locale, 'rail.creators.more')}
    >
      {items.map((item) => (
        <LineRow key={item.id} item={item} />
      ))}
    </RailPanel>
  );
}
