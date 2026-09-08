'use client';

import Link from '@/components/Link';
import type { NewsItem } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { useLocale } from '@/lib/i18n/locale-context';
import {
  STORE_PLATE,
  clockLabel,
  isPostSource,
  isReleaseSource,
  safeExternalUrl,
  shortDate,
  shortDay,
  stringOrNull,
  utcToday,
  vnPath,
} from '@/lib/news';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { bodyAfterTitle, plateFor, Thumb } from './HeadlineRow';

const JAPANESE = /[぀-ヿ一-鿿]/;

/** A post title this short is a heading, not a sentence: a bracketed brand name, a tag. */
const HEADING_MAX = 24;
const LINE_MAX = 90;

/**
 * What a one-line row or a ticker entry says for an item. A post's title is its first
 * line, which is often no more than a bracketed heading; the body's first sentence is
 * added so the line means something on its own.
 */
export function lineTitle(item: NewsItem, title: string): string {
  if (!isPostSource(item.source) || title.trim().length > HEADING_MAX) return title;
  const body = bodyAfterTitle(item);
  if (!body) return title;
  const first = body.split('\n').map((l) => l.trim()).find(Boolean);
  if (!first) return title;
  const joined = `${title.trim()} ${first}`;
  return joined.length > LINE_MAX ? `${joined.slice(0, LINE_MAX - 1)}…` : joined;
}

/** What the short plate says for any item: the network and account, the store, or the outlet. */
export function linePlate(item: NewsItem, locale: Locale): string {
  if (isPostSource(item.source) || item.source === 'rss' || item.source === 'announcement') {
    return plateFor(item, locale);
  }
  if (isReleaseSource(item.source)) return STORE_PLATE[item.source] ?? 'VNDB';
  // A line has no room for the catalogue's full label; the site's name is enough.
  if (item.source === 'vndb') return 'VNDB';
  return item.sourceLabel;
}

/**
 * Where a line goes: the site's own page for a release the catalogue knows, else the
 * item's link. A review links to the review; the title page link stays on the featured row.
 */
export function lineHref(item: NewsItem): { href: string; internal: boolean } | null {
  if (isReleaseSource(item.source) && item.vnId) {
    const internal = vnPath(item.vnId);
    if (internal) return { href: internal, internal: true };
  }
  const external = safeExternalUrl(item.url);
  return external ? { href: external, internal: false } : null;
}

/**
 * One item on one line: a small picture, the title cut to the width, the plate and the
 * clock. Used for everything past a day's first illustrated few, and in the rails.
 *
 * `note` replaces the clock where a count says more than a time, as on a board thread.
 */
export function LineRow({ item, note = null }: { item: NewsItem; note?: string | null }) {
  const locale = useLocale();
  const { preference } = useTitlePreference();
  const target = lineHref(item);
  const extra = item.extraData ?? {};
  // A row the catalogue knows carries both scripts of the name, so it follows the reader's
  // choice; anything else has the one name the source printed.
  const name = item.vnId
    ? getDisplayTitle(
        {
          title: item.title,
          title_jp: stringOrNull(extra.alttitle) ?? undefined,
          title_romaji: stringOrNull(extra.title_romaji) ?? undefined,
        },
        preference,
      )
    : item.title;
  const title = lineTitle(item, name);
  const day = item.publishedAt.slice(0, 10);
  const today = utcToday();
  let clock: string | null;
  let stamp = item.publishedAt;
  if (isReleaseSource(item.source) || item.source === 'vndb') {
    // A catalogue or storefront row is about the day the entry names. Its stamp is the
    // moment the aggregator saw it, which says nothing to a reader.
    const named = stringOrNull(extra.released) ?? day;
    clock = shortDay(named, locale);
    stamp = named;
  } else if (item.source === 'vndb_review' || day !== today) {
    // The catalogue site dates reviews to the day, so a clock there would be invented;
    // past the current day a clock names an hour without saying which day it belongs to.
    clock = shortDate(item.publishedAt, today, locale);
  } else {
    clock = clockLabel(item.publishedAt);
  }

  return (
    <article className="nw-line">
      {target &&
        (target.internal ? (
          <Link href={target.href} className="nw-row-link" aria-label={title} />
        ) : (
          <a
            href={target.href}
            target="_blank"
            rel="noopener noreferrer"
            className="nw-row-link"
            aria-label={title}
          />
        ))}
      <Thumb item={item} className="nw-line-thumb" />
      <span className="nw-line-title" title={title} lang={JAPANESE.test(title) ? 'ja' : undefined}>
        {title}
      </span>
      <span className="nw-line-plate nameplate nameplate--plain">{linePlate(item, locale)}</span>
      {note ? (
        <span className="nw-line-time">{note}</span>
      ) : (
        clock && (
          <time className="nw-line-time" dateTime={stamp}>
            {clock}
          </time>
        )
      )}
    </article>
  );
}
