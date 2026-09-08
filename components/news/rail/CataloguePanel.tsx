'use client';

import { NSFWImage } from '@/components/NSFWImage';
import { VNTitle } from '@/components/VNTitle';
import { getCoverSrc } from '@/lib/vndb-image-cache';
import type { NewsItem } from '@/lib/news';
import { developerNames, newsPath, safeExternalUrl, stringOrNull } from '@/lib/news';
import { useTitlePreference } from '@/lib/title-preference';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { RailPanel } from './RailPanel';

/**
 * The newest catalogue entries, with their covers. These link to VNDB: an entry added
 * today is not in the dump yet, so the site has no page for it until the next import.
 */
export function CataloguePanel({ locale, items }: { locale: Locale; items: NewsItem[] }) {
  const { preference } = useTitlePreference();
  if (items.length === 0) return null;
  return (
    <RailPanel
      plate={ns(locale, 'rail.catalogue')}
      href={newsPath(locale, '/news/recently-added/')}
      hrefLabel={ns(locale, 'rail.catalogue.more')}
    >
      <ul className="nw-release-list">
        {items.map((item) => {
          const href = safeExternalUrl(item.url);
          const studio = developerNames(item, preference)[0];
          const art = getCoverSrc(item.imageUrl, { width: 128 });
          const body = (
            <span className="rel-row">
              <span className="rel-art">
                {art && (
                  <NSFWImage
                    src={art}
                    alt={item.title}
                    vnId={item.vnId ?? undefined}
                    imageSexual={item.imageIsNsfw ? 2 : 0}
                    className="h-full w-full object-cover object-top"
                    compact
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="rel-title">
                  <VNTitle title={item.title} title_jp={stringOrNull(item.extraData?.alttitle)} />
                </span>
                {studio && <span className="rel-meta">{studio}</span>}
              </span>
            </span>
          );
          return (
            <li key={item.id} className="nw-release">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {body}
                </a>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </RailPanel>
  );
}
