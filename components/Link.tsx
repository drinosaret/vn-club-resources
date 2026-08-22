import NextLink from 'next/link';
import type { ComponentProps } from 'react';

/**
 * The site's link, which does not fetch what it points at until there is a reason to.
 *
 * Next prefetches a link as soon as it scrolls into view. On a page holding one or two
 * onward journeys that is free speed; on a results grid, a leaderboard, or a header carried
 * by every page, it turns one arrival into a request for everything visible. Anything
 * walking the site systematically therefore multiplies its own rate by the number of links
 * per page, and the site answers all of it.
 *
 * Off by default, the fetch happens on hover instead, which a reader does before clicking
 * and an automated visitor never does. Pass `prefetch` explicitly where an onward step is
 * genuinely expected.
 */
export default function Link({
  prefetch = false,
  ...rest
}: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...rest} />;
}
