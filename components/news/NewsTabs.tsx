'use client';

import Link from '@/components/Link';
import { TABS, newsPath, type Lang } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { skipNextScroll } from '@/components/ScrollToTop';

/**
 * The row of sections. The front page is the first tab; the schedule is the last.
 *
 * `controls` sits opposite the tabs on the same row: the page's own switches, which belong
 * with the navigation rather than in a rail panel of their own.
 */
export function NewsTabs({
  active,
  lang = null,
  locale = 'en',
  controls = null,
}: {
  active: string;
  lang?: Lang | null;
  locale?: Locale;
  controls?: React.ReactNode;
}) {
  return (
    <div className="nw-tabs-row">
      <div className="tabs" role="tablist" aria-label="News sections">
        {TABS.map((tab) => {
          const isActive = active === tab.slug;
          return (
            <Link
              key={tab.slug}
              href={newsPath(locale, lang && tab.slug !== 'upcoming' ? `${tab.href}?lang=${lang}` : tab.href)}
              onClick={skipNextScroll}
              role="tab"
              aria-selected={isActive}
              className={isActive ? 'tab tab--on' : 'tab'}
            >
              {ns(locale, `tab.${tab.slug}` as 'tab.front')}
            </Link>
          );
        })}
      </div>
      {controls && <div className="nw-tabs-controls">{controls}</div>}
    </div>
  );
}
