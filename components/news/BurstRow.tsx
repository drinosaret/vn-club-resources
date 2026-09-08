'use client';

import { useState } from 'react';
import type { NewsItem } from '@/lib/news';
import { clockLabel, safeExternalUrl } from '@/lib/news';
import { useLocale } from '@/lib/i18n/locale-context';
import { ns } from '@/lib/i18n/translations/news';
import { plateFor, Thumb, titleLineCount } from './HeadlineRow';

/** The first line of the post past the ones its title was made from, when there is one. */
function secondLine(item: NewsItem): string | null {
  const lines = (item.summary ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const used = titleLineCount(item.title, lines);
  // A bare address says nothing in a cell; the row itself is the link.
  return lines.slice(used).find((l) => !/^https?:\/\/\S+$/.test(l)) ?? null;
}

const JAPANESE = /[぀-ヿ一-鿿]/;

/** How many of a burst are shown before the rest fold away. */
const SHOWN_FOLDED = 4;

/**
 * A run of posts from one account, folded into a single row.
 *
 * An account that relays every brand's announcement can post a dozen times in an hour, and
 * a dozen rows from it would push everything else off the top of the page. The run keeps one
 * plate and one time span, and the posts sit in a grid inside it, so the reader sees that the
 * account was busy, can scan what it said, and can still open any one of them.
 */
export function BurstRow({ items }: { items: NewsItem[] }) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const first = items[0];
  const last = items[items.length - 1];
  const shown = open ? items : items.slice(0, SHOWN_FOLDED);
  const hidden = items.length - shown.length;

  return (
    <article className="nw-burst">
      <div className="nw-meta">
        <span className="nameplate nameplate--plain">{plateFor(first, locale)}</span>
        <span>{ns(locale, 'burst.posts', { n: items.length })}</span>
        <time dateTime={last.publishedAt}>{clockLabel(last.publishedAt)}</time>
        <span aria-hidden="true">–</span>
        <time dateTime={first.publishedAt}>{clockLabel(first.publishedAt)}</time>
      </div>
      <ul className="nw-burst-grid">
        {shown.map((item) => {
          const href = safeExternalUrl(item.url);
          const body = (
            <>
              <Thumb item={item} className="nw-burst-thumb" />
              <span className="nw-burst-text">
                <span className="nw-burst-title" lang={JAPANESE.test(item.title) ? 'ja' : undefined}>
                  {item.title}
                </span>
                {secondLine(item) && (
                  <span className="nw-burst-sub" lang={JAPANESE.test(secondLine(item) ?? '') ? 'ja' : undefined}>
                    {secondLine(item)}
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={item.id} className="nw-burst-cell">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="nw-burst-link">
                  {body}
                </a>
              ) : (
                <span className="nw-burst-link">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || open) && (
        <button type="button" className="nw-burst-more" onClick={() => setOpen(!open)}>
          {open ? ns(locale, 'burst.showFewer') : ns(locale, 'burst.showAll', { n: items.length })}
        </button>
      )}
    </article>
  );
}
