'use client';

import { VNTitle } from '@/components/VNTitle';
import type { NewsItem } from '@/lib/news';
import { developerNames, safeExternalUrl, stringOrNull, vnPath } from '@/lib/news';
import { getCoverSrc, getNewsImageUrl } from '@/lib/vndb-image-cache';
import { useTitlePreference } from '@/lib/title-preference';
import { StripCover } from './StripCover';

/**
 * Up to six covers in a row. A catalogue entry added today is not in the dump yet, so a
 * new entry links to VNDB; a release the site knows links to its own page.
 */
export function CoverStrip({ items }: { items: NewsItem[] }) {
  const { preference } = useTitlePreference();
  return (
    <ul className="nw-strip nw-strip--covers">
      {items.map((item) => {
        const internal = item.source !== 'vndb' ? vnPath(item.vnId) : null;
        const art = getCoverSrc(item.imageUrl, { width: 128 }) ?? (item.imageUrl ? getNewsImageUrl(item.imageUrl) : null);
        return (
          <StripCover
            key={item.id}
            href={internal ?? safeExternalUrl(item.url) ?? null}
            external={!internal}
            art={art}
            alt={item.title}
            vnId={item.vnId ?? undefined}
            imageSexual={item.imageIsNsfw ? 2 : 0}
            title={<VNTitle title={item.title} title_jp={stringOrNull(item.extraData?.alttitle)} />}
            sub={developerNames(item, preference)[0] ?? null}
          />
        );
      })}
    </ul>
  );
}
