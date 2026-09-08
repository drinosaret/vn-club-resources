import type { NewsItem } from '@/lib/news';
import { newsPath } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { LineRow } from '../LineRow';
import { RailPanel } from './RailPanel';

/** The busiest threads on the boards, by the reply count the board reported. */
export function BoardsPanel({ locale, items }: { locale: Locale; items: NewsItem[] }) {
  if (items.length === 0) return null;
  return (
    <RailPanel
      plate={ns(locale, 'rail.boards')}
      href={newsPath(locale, '/news/community/')}
      hrefLabel={ns(locale, 'rail.boards.more')}
    >
      {items.map((item) => {
        const replies = item.extraData?.replies;
        const note = typeof replies === 'number' ? ns(locale, 'rail.replies', { n: replies }) : null;
        return <LineRow key={item.id} item={item} note={note} />;
      })}
    </RailPanel>
  );
}
