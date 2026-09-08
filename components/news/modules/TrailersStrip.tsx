'use client';

import type { NewsItem } from '@/lib/news';
import { safeExternalUrl } from '@/lib/news';
import { getNewsImageUrl } from '@/lib/vndb-image-cache';
import { StripCover } from './StripCover';

const JAPANESE = /[぀-ヿ一-鿿]/;

/** Up to four video stills in a row, each linking out to the upload. */
export function TrailersStrip({ items }: { items: NewsItem[] }) {
  return (
    <ul className="nw-strip">
      {items.map((item) => (
        <StripCover
          key={item.id}
          href={safeExternalUrl(item.url) ?? null}
          external
          art={item.imageUrl ? getNewsImageUrl(item.imageUrl) : null}
          alt={item.title}
          imageSexual={item.imageIsNsfw ? 2 : 0}
          title={item.title}
          sub={item.sourceLabel}
          wide
          lang={JAPANESE.test(item.title) ? 'ja' : undefined}
        />
      ))}
    </ul>
  );
}
