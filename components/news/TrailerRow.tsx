'use client';

import { useState } from 'react';
import type { NewsItem } from '@/lib/news';
import { clockLabel, safeExternalUrl, shortDate, utcToday } from '@/lib/news';
import { useLocale } from '@/lib/i18n/locale-context';
import { getNewsImageUrl } from '@/lib/vndb-image-cache';

const JAPANESE = /[぀-ヿ一-鿿]/;

/**
 * One upload: its still, the channel, the title. It links out rather than embedding a
 * player, since a page of players is slow and each one reports the visit.
 */
export function TrailerRow({ item, today }: { item: NewsItem; today?: string }) {
  const locale = useLocale();
  const [broken, setBroken] = useState(false);
  const href = safeExternalUrl(item.url);
  const still = !broken && item.imageUrl ? getNewsImageUrl(item.imageUrl) : null;
  // A row under a dated heading takes that day; standing on its own it names the date
  // unless it belongs to the current day, where a clock is unambiguous.
  const day = today ?? utcToday();
  const when =
    today || item.publishedAt.slice(0, 10) !== day
      ? shortDate(item.publishedAt, day, locale)
      : clockLabel(item.publishedAt);

  return (
    <article className="nw-trailer">
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="nw-row-link"
          aria-label={item.title}
        />
      )}
      <span className="nw-trailer-art">
        {still && <img src={still} alt="" loading="lazy" onError={() => setBroken(true)} />}
      </span>
      <div className="nw-row-body">
        <div className="nw-meta">
          <span className="nameplate nameplate--plain">{item.sourceLabel}</span>
          <time dateTime={item.publishedAt}>{when}</time>
        </div>
        <h3 className="nw-title" lang={JAPANESE.test(item.title) ? 'ja' : undefined}>
          {item.title}
        </h3>
      </div>
    </article>
  );
}
