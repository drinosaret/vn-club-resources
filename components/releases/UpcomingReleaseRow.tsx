import { safeExternalUrl } from '@/lib/news';
import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { getCoverSrc, getNewsImageUrl } from '@/lib/vndb-image-cache';
import { platformLabel } from '@/lib/platforms';
import { yen } from '@/lib/news';
import { formatReleaseDayBadge, type ReleaseLocale, type UpcomingRelease } from '@/lib/upcoming-releases';
import { EntityName } from '@/components/EntityName';
import { ns } from '@/lib/i18n/translations/news';

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
 *
 * An entry that exists only as a storefront listing has no page on this site, so its name
 * leads to the store instead. Where a store takes orders for a title the catalogue knows,
 * the store's line sits under the row and the name still leads to the title's own page.
 */

// Beyond this the row turns into a platform list rather than a release entry.
const MAX_PLATFORMS = 4;

export function UpcomingReleaseRow({ item, locale = 'en' }: { item: UpcomingRelease; locale?: ReleaseLocale }) {
  const romanised = item.title_romaji || item.title;
  const primary = item.title_jp || romanised;
  const secondary = romanised !== primary ? romanised : null;
  // A store's own picture is not on the catalogue's host, so it takes the news route.
  const cover = item.image_url
    ? (getCoverSrc(item.image_url, { width: 128 }) ?? getNewsImageUrl(item.image_url))
    : null;
  const platforms = item.platforms.slice(0, MAX_PLATFORMS);
  const extraPlatforms = item.platforms.length - platforms.length;
  const listing = item.listing;
  // A store address comes from a scraped listing, so it is held to http(s) before it is a link.
  const storeHref = safeExternalUrl(listing?.url);

  const body = (
    <span className="rel-row">
      <span className="rel-art">
        {cover && (
          <NSFWImage
            src={cover}
            alt={romanised}
            vnId={item.storeOnly ? undefined : item.id}
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

        {listing && (
          <span className="rel-meta rel-line">
            <span className="nameplate nameplate--plain">{listing.store}</span>
            {listing.price && <span className="rel-score">{yen(listing.price)}</span>}
            {listing.bonus && <span className="rel-chip">{ns(locale, 'rel.bonus')}</span>}
            {item.editions !== undefined && item.editions > 1 && (
              <span className="rel-chip">
                {item.editions - 1 === 1
                  ? ns(locale, 'rel.editionsOne')
                  : ns(locale, 'rel.editions', { n: item.editions - 1 })}
              </span>
            )}
          </span>
        )}
      </span>

      <span className="rel-when">{formatReleaseDayBadge(item, locale)}</span>
    </span>
  );

  return (
    <li className="nw-release">
      {item.storeOnly ? (
        storeHref ? (
          <a href={storeHref} target="_blank" rel="noopener noreferrer">
            {body}
          </a>
        ) : (
          body
        )
      ) : (
        <Link href={`/vn/${item.id}/`}>{body}</Link>
      )}
      {!item.storeOnly && storeHref && (
        <a href={storeHref} target="_blank" rel="noopener noreferrer" className="nw-release-store">
          {ns(locale, 'link.preorder')} ↗
        </a>
      )}
    </li>
  );
}
