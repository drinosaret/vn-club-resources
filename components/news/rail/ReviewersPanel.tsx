import type { RailReviewer } from '@/lib/news';
import { safeExternalUrl } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { RailPanel } from './RailPanel';

/**
 * Who wrote the most reviews in the last month. Names are as the sources print them, and
 * each links to the reviewer's page on the source site where the source names one.
 */
export function ReviewersPanel({ locale, items }: { locale: Locale; items: RailReviewer[] }) {
  if (items.length === 0) return null;
  return (
    <RailPanel plate={ns(locale, 'rail.reviewers')}>
      <p className="nw-rail-sub">{ns(locale, 'rail.mostReviewed.sub')}</p>
      <ol className="nw-reviewers">
        {items.map((r, i) => {
          const href = safeExternalUrl(r.url);
          return (
          <li key={`${r.name}-${i}`} className="nw-reviewer">
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="nw-reviewer-name">
                {r.name}
              </a>
            ) : (
              <span>{r.name}</span>
            )}
            <span className="nw-count">
              {r.count === 1 ? ns(locale, 'rail.reviewCountOne') : ns(locale, 'rail.reviewCount', { n: r.count })}
            </span>
          </li>
          );
        })}
      </ol>
    </RailPanel>
  );
}
