import Link from '@/components/Link';

import type { SiteDirectory } from '@/lib/navigation';

/**
 * Everything the site publishes, in one band.
 *
 * A home page for a site with this many pages has to answer "what else is here", and answering
 * it by choosing a handful of favourites means the rest is reachable only from a menu. The list
 * is generated from the navigation, so a new page joins it without a second edit and cannot
 * drift out of step with the header and the footer.
 *
 * The columns are composed rather than taken one per navigation section, because those sections
 * range from two entries to seventeen and a column each would leave most of the band empty. The
 * grouping here is for reading; the navigation's own grouping is for finding.
 *
 * It sits near the foot deliberately. Somebody who already knows what they came for has passed
 * it; somebody who does not has run out of other things to read by the time they reach it.
 */

interface DirectoryProps {
  directory: SiteDirectory;
}

interface Entry {
  href: string;
  label: string;
  note?: string;
}

/**
 * The pages that exist to be played with rather than read.
 *
 * They have a band of their own further up that draws what each one does, so listing them here
 * again would be the same six links twice on one page.
 */
const FOR_FUN = new Set([
  '/tierlist/',
  '/3x3-maker/',
  '/roulette/',
  '/higher-or-lower/',
  '/quiz/',
  '/random/',
]);

function normalise(href: string): string {
  return href.endsWith('/') ? href : `${href}/`;
}

export function Directory({ directory }: DirectoryProps) {
  const section = (title: string): Entry[] =>
    directory.mainSections
      .find((s) => s.title === title)
      ?.items.map((item) => ({ href: normalise(item.href), label: item.name })) ?? [];

  const explore = section('Features').filter((item) => !FOR_FUN.has(item.href));

  const guides: Entry[] = directory.guides.map((guide) => ({
    href: `/${guide.slug}/`,
    // The navigation titles carry a trailing "Guide" that is redundant under this heading.
    label: guide.title.replace(/\s+Guide$/i, ''),
    // A tool's name does not say what it is for, and most of these names are invented, so the
    // guides are the one column here that has to be read rather than scanned.
    note: guide.description,
  }));

  const stacked = [
    { title: 'Start here', items: section('Start Here') },
    { title: 'Resources', items: section('Resources') },
    { title: 'Community', items: section('Community') },
  ].filter((group) => group.items.length > 0);

  if (stacked.length === 0 && explore.length === 0 && guides.length === 0) return null;

  return (
    <section aria-labelledby="directory" className="dir">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="sec-head">
          <div>
            <h2 id="directory" className="sec-title">
              Everything here
            </h2>
            <p className="sec-sub">Every page on the site, in one list.</p>
          </div>
        </div>

        <div className="dir-grid">
          <div>
            {stacked.map((group) => (
              <div key={group.title} className="dir-block">
                <Column title={group.title} items={group.items} />
              </div>
            ))}
          </div>

          {explore.length > 0 && <Column title="Explore" items={explore} />}

          {guides.length > 0 && (
            <div className="dir-col--wide">
              <Column title="Guides" items={guides} split />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Column({
  title,
  items,
  split = false,
}: {
  title: string;
  items: Entry[];
  split?: boolean;
}) {
  const noted = items.some((item) => item.note);
  const classes = ['dir-list', split ? 'dir-list--split' : '', noted ? 'dir-list--noted' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <h3 className="nameplate nameplate--plain dir-col-title">{title}</h3>
      <ul className={classes}>
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href}>
              <span className="dir-name">{item.label}</span>
              {item.note && <span className="dir-note">{item.note}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
