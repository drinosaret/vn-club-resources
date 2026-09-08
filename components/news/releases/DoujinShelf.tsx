'use client';

import { useState } from 'react';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import type { NewsItem } from '@/lib/news';
import { ReleaseTile } from '../ReleaseTile';
import { RailPanel } from '../rail/RailPanel';

/** Two rows of the wide grid before the fold. */
const SHOWN = 12;

/** What the doujin and indie storefronts put out, newest first. */
export function DoujinShelf({ locale, items }: { locale: Locale; items: NewsItem[] }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const tiles = all ? items : items.slice(0, SHOWN);

  return (
    <RailPanel id="rel-doujin" plate={ns(locale, 'rel.doujin')}>
      <p className="nw-rail-sub">{ns(locale, 'rel.doujin.sub')}</p>
      <ul className="nw-shelf-tiles nw-shelf-tiles--wide">
        {tiles.map((item) => (
          <ReleaseTile key={item.id} item={item} badge="price" />
        ))}
      </ul>
      {items.length > SHOWN && (
        <button type="button" className="nw-step nw-shelf-more" onClick={() => setAll((open) => !open)}>
          {all ? ns(locale, 'rel.showFewer') : ns(locale, 'rel.showAll', { n: items.length })}
        </button>
      )}
    </RailPanel>
  );
}
