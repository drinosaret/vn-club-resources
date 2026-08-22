'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { STATS_PAGES } from './stats-pages';

/**
 * The stats section's own navigation, at the top of every page in it.
 *
 * The cross-links at the foot of each page are a reading destination: you finish a page and
 * they offer the next one. They cannot also be the navigation, because these pages run to
 * are long and on a phone the first link to a sibling page sits far below the fold. Somebody
 * who wants Rankings while looking at Global stats should not have to
 * read all of Global stats to find it.
 *
 * Wraps rather than scrolls. A horizontal scroller fits any number of items and hides most of
 * them, which is the problem itself rather than a smaller version of it.
 *
 * Laid out as a grid where it has to wrap. Free wrapping leaves the last row short, and a
 * ragged edge under a full one reads as something that ran out of room rather than as a
 * arrangement anyone chose. A grid gives every row the same edges. It stays left-aligned
 * because most pages in this section align their heading left, and centred chrome above a
 * left-aligned page looks misplaced on the pages that outnumber the centred ones.
 */

/**
 * Which entry the current path belongs to.
 *
 * A reader's own page and a board page are inside a section rather than being one, so the
 * section they sit under is marked instead. Longest match wins, or `/stats/` would claim
 * every page in the section.
 *
 * A list belonging to somebody else still marks "Yours": the pill names the section a page
 * sits in, and leaving every pill unlit on the one page a reader arrives at most often
 * reads as navigation that has lost track of where they are.
 */
function activeHref(pathname: string): string | null {
  const matches = STATS_PAGES.filter((page) => pathname.startsWith(page.href)).map(
    (page) => page.href,
  );
  if (!matches.length) return null;
  return matches.sort((a, b) => b.length - a.length)[0];
}

export function StatsSectionNav() {
  const pathname = usePathname();
  const active = activeHref(pathname ?? '');

  return (
    <nav
      aria-label="Statistics pages"
      className="mx-auto max-w-7xl px-4 pt-4 sm:pt-6"
    >
      <ul className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap">
        {STATS_PAGES.map(({ href, label, Icon }) => {
          const isActive = href === active;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors sm:w-auto ${
                  isActive
                    ? 'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-500 dark:bg-primary-900/30 dark:text-primary-300'
                    : 'border-gray-200 text-gray-600 hover:border-primary-400 hover:text-primary-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-primary-600 dark:hover:text-primary-300'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
