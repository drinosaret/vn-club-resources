import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { getCoverSrc } from '@/lib/vndb-image-cache';
import { platformLabel } from '@/lib/platforms';
import { formatReleaseDayBadge, type UpcomingRelease } from '@/lib/upcoming-releases';
import { EntityName } from '@/components/EntityName';

/**
 * One announced title, rendered on the server so the whole schedule is in the delivered HTML.
 *
 * The Japanese title leads where there is one, with the romanisation beneath it, matching every
 * other list on the site: that is the script these are read in. The reader's stored title
 * preference lives in the browser and is deliberately not consulted here, since the page has to
 * be readable before any of it runs.
 *
 * The listing carries only titles whose original language is Japanese, which the page says in
 * its own words, so no per-row badge repeats it.
 */

// Beyond this the row turns into a platform list rather than a release entry.
const MAX_PLATFORMS = 4;

export function UpcomingReleaseRow({ item }: { item: UpcomingRelease }) {
  const romanised = item.title_romaji || item.title;
  const primary = item.title_jp || romanised;
  const secondary = romanised !== primary ? romanised : null;
  const cover = item.image_url ? getCoverSrc(item.image_url, { width: 128 }) : null;
  const platforms = item.platforms.slice(0, MAX_PLATFORMS);
  const extraPlatforms = item.platforms.length - platforms.length;

  return (
    <li>
      <Link href={`/vn/${item.id}/`} className="rel-row">
        <span className="rel-art">
          {cover && (
            <NSFWImage
              src={cover}
              alt={romanised}
              vnId={item.id}
              imageSexual={item.image_sexual ?? 0}
              className="h-full w-full object-cover object-top"
              compact
            />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="rel-title" lang={item.title_jp ? 'ja' : undefined}>
            {primary}
            {item.minage === 18 && <span className="rel-age">18+</span>}
          </span>

          {secondary && <span className="rel-alt">{secondary}</span>}

          <span className="rel-meta">
            {item.developers.length > 0
              ? item.developers.flatMap((credit, index) => [
                  index === 0 ? null : ', ',
                  <EntityName key={credit.name} name={credit.name} original={credit.original} />,
                ])
              : 'Developer not credited'}
          </span>

          {platforms.length > 0 && (
            <span className="rel-meta">
              {platforms.map((code) => platformLabel(code)).join(' · ')}
              {extraPlatforms > 0 && ` +${extraPlatforms}`}
            </span>
          )}
        </span>

        <span className="rel-when">{formatReleaseDayBadge(item)}</span>
      </Link>
    </li>
  );
}
