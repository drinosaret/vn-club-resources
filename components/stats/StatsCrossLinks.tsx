import Link from '@/components/Link';

import { STATS_PAGES } from './stats-pages';

/**
 * Where else to go from any stats page.
 *
 * The stats section spans several pages that are each other's most likely next destination.
 * One component, rendered at the foot of each, so adding a page means adding it to the shared
 * list rather than editing every sibling.
 */

/** The pages this component knows about, plus the case where the reader is on none of them. */
export type StatsPageKey = (typeof STATS_PAGES)[number]['key'];



interface StatsCrossLinksProps {
  /**
   * The page being viewed, which is left out of its own list. A detail page sitting under one
   * of these passes 'none': it is not itself a destination, and the section it belongs to is
   * the most useful link on it, so nothing is dropped.
   */
  current: StatsPageKey | 'none';
  className?: string;
}

export function StatsCrossLinks({ current, className = '' }: StatsCrossLinksProps) {
  const others = STATS_PAGES.filter((page) => page.key !== current && !page.outsideSection);
  // A page that sits outside the stats section (the recommendations page) links onward
  // to the stats pages without being one of them, so its heading says so.
  const heading = STATS_PAGES.find((page) => page.key === current)?.outsideSection
    ? 'More to explore'
    : 'Elsewhere in stats';

  return (
    <nav aria-label="Other statistics pages" className={`mt-12 ${className}`}>
      <h2 className="fig-label mb-3">{heading}</h2>
      {/* Wrapping flex rather than a fixed column count. The list is four or five cards
          depending on the page, and this footer sits in containers of different widths, so a
          set number of columns leaves a lone stranded card on some combination of the two.
          Here the cards on the final row grow to fill it instead. */}
      <div className="flex flex-wrap gap-3">
        {others.map(({ key, href, title, blurb }) => (
          <Link
            key={key}
            href={href}
            className="st-card st-card--pick group flex min-w-0 flex-1 basis-52 flex-col gap-1 p-3.5"
          >
            <span className="st-card-title group-hover:text-[color:var(--ai)] transition-colors">
              {title}
            </span>
            <span className="st-card-sub">{blurb}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
