import type { NewsItem } from '@/lib/news';
import { newsPath } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { ReviewRow } from '../ReviewRow';
import { RailPanel } from './RailPanel';

/** The newest reviews from every review source, as a window onto the reviews page. */
export function ReviewsPanel({ locale, items }: { locale: Locale; items: NewsItem[] }) {
  if (items.length === 0) return null;
  return (
    <RailPanel
      plate={ns(locale, 'rail.reviews')}
      href={newsPath(locale, '/news/reviews/')}
      hrefLabel={ns(locale, 'rail.reviews.more')}
    >
      <div className="nw-rail-reviews">
        {items.slice(0, 5).map((item) => (
          <ReviewRow key={item.id} item={item} compact />
        ))}
      </div>
    </RailPanel>
  );
}
