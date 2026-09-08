import type { NewsItem } from '@/lib/news';
import { newsPath } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { ReleaseRow } from '../ReleaseRow';
import { RailPanel } from './RailPanel';

/** The rail shows the deepest few cuts; the releases page carries the whole list. */
const MAX_ROWS = 3;

/** Japanese titles currently discounted on Steam, as of the last storefront check. */
export function SalePanel({ locale, items }: { locale: Locale; items: NewsItem[] }) {
  if (items.length === 0) return null;
  return (
    <RailPanel
      plate={ns(locale, 'rail.sale')}
      href={newsPath(locale, '/news/releases/#rel-sale')}
      hrefLabel={ns(locale, 'rail.sale.more')}
    >
      <ul className="nw-release-list">
        {items.slice(0, MAX_ROWS).map((item) => (
          <ReleaseRow key={item.id} item={item} badge="sale" />
        ))}
      </ul>
      <p className="dg-note">{ns(locale, 'rail.sale.note')}</p>
    </RailPanel>
  );
}
