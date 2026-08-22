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

  return (
    <nav aria-label="Other statistics pages" className={`mt-12 ${className}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">
        Elsewhere in stats
      </h2>
      {/* Wrapping flex rather than a fixed column count. The list is four or five cards
          depending on the page, and this footer sits in containers of different widths, so a
          set number of columns leaves a lone stranded card on some combination of the two.
          Here the cards on the final row grow to fill it instead. */}
      <div className="flex flex-wrap gap-3">
        {others.map(({ key, href, title, blurb, Icon }) => (
          <Link
            key={key}
            href={href}
            className="group flex min-w-0 flex-1 basis-52 flex-col gap-1 rounded-xl border border-gray-200/60 bg-white p-3.5 transition-colors hover:border-primary-400 dark:border-gray-700/80 dark:bg-gray-800 dark:hover:border-primary-600"
          >
            <span className="flex items-center gap-2">
              <Icon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
              <span className="font-semibold text-sm text-gray-900 dark:text-white group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors">
                {title}
              </span>
            </span>
            <span className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
              {blurb}
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
