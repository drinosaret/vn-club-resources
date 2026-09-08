'use client';

import { useState } from 'react';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { numberOrNull, type NewsItem } from '@/lib/news';
import { ReleaseRow } from '../ReleaseRow';
import { RailPanel } from '../rail/RailPanel';

/** How many cuts the shelf shows before the rest are folded behind a control. */
const SHOWN = 8;

function discountOf(item: NewsItem): number {
  return numberOrNull(item.extraData?.discount) ?? 0;
}

/** Everything currently discounted, deepest cut first. */
export function SaleShelf({ locale, items }: { locale: Locale; items: NewsItem[] }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => discountOf(b) - discountOf(a));
  const rows = all ? sorted : sorted.slice(0, SHOWN);

  return (
    <RailPanel id="rel-sale" plate={ns(locale, 'rel.onSale')}>
      <ul className="nw-release-list">
        {rows.map((item) => (
          <ReleaseRow key={item.id} item={item} badge="sale" />
        ))}
      </ul>
      {sorted.length > SHOWN && (
        <button type="button" className="nw-step nw-shelf-more" onClick={() => setAll((open) => !open)}>
          {all ? ns(locale, 'rel.showFewer') : ns(locale, 'rel.showAll', { n: sorted.length })}
        </button>
      )}
      <p className="dg-note">{ns(locale, 'rail.sale.note')}</p>
    </RailPanel>
  );
}
