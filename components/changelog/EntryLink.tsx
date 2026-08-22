import Link from 'next/link';

/**
 * One link attached to a changelog entry.
 *
 * Shared because the same entries are listed in two places, the changelog itself and the
 * homepage, and a link that opens in a new tab on one page and navigates in place on the
 * other is the kind of difference nobody notices until it is wrong.
 *
 * No hooks, so it renders inside the changelog's client component and the homepage's server
 * component alike.
 */
export function EntryLink({ label, href }: { label: string; href: string }) {
  const className = 'text-primary-600 dark:text-primary-400 hover:underline';

  // An internal path routes in place; anything else leaves the site and says so to the browser.
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={className}>
        {label}
      </Link>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {label}
    </a>
  );
}
