'use client';

import { useState } from 'react';
import { NSFWImage } from '@/components/NSFWImage';
import type { NewsItem } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { useLocale } from '@/lib/i18n/locale-context';
import { ns } from '@/lib/i18n/translations/news';
import { clockLabel, isPostSource, safeExternalUrl } from '@/lib/news';
import { getNewsImageUrl } from '@/lib/vndb-image-cache';
import { LinkifiedText } from './LinkifiedText';

const NETWORK: Record<string, string> = {
  twitter: 'X',
  bluesky: 'Bluesky',
  creator: 'X',
  bsky_search: 'Bluesky',
};

/** What the plate says: the outlet, or the network and the account for a social post. */
export function plateFor(item: NewsItem, locale: Locale = 'en'): string {
  if (item.source === 'announcement') return ns(locale, 'plate.club');
  const network = NETWORK[item.source];
  const base = network ? `${network} · ${item.sourceLabel}` : item.sourceLabel;
  // A calendar post marking a release anniversary says so on the plate.
  return item.extraData?.kind === 'anniversary' ? `${base} · ${ns(locale, 'plate.onThisDay')}` : base;
}

const JAPANESE = /[぀-ヿ一-鿿]/;

/**
 * The part of a post that is not already its title. A post has no title of its own, so
 * the first line stands as one and the rest follows; a title that had to be cut leaves
 * the whole text in place beneath it.
 */
export function bodyAfterTitle(item: NewsItem): string | null {
  const summary = item.summary?.trim();
  if (!summary) return null;
  if (!isPostSource(item.source)) return summary;
  const lines = summary.split('\n');
  const body = lines.slice(titleLineCount(item.title, lines)).join('\n').trim();
  return body || null;
}

/**
 * How many leading lines of a post's text its title was made from, blank lines included:
 * up to the first line of text, or up to the second when the first was only a heading and
 * the aggregator joined the next line to it, or none when the title was cut and the whole
 * text should stand beneath it.
 */
export function titleLineCount(title: string, lines: string[]): number {
  // Whitespace is dropped on both sides: the join between a heading and the line after
  // it is a space in one script and nothing in the other, and a post may leave a blank
  // line between them.
  const squash = (s: string) => s.replace(/\s+/g, '');
  const wanted = squash(title);
  const filled = lines.map((l, i) => ({ text: squash(l), end: i + 1 })).filter((l) => l.text);
  const [first, second] = filled;
  if (first && first.text === wanted) return first.end;
  if (first && second && first.text + second.text === wanted) return second.end;
  return 0;
}

function hostOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

/**
 * The mark that stands in when an item brought no picture: the account's own avatar for a
 * post, otherwise the favicon of the page it points at (the linked page for a post, the
 * article for everything else).
 */
function standInMark(item: NewsItem): { src: string; avatar: boolean } | null {
  const avatar = item.extraData?.avatar_url;
  if (typeof avatar === 'string') {
    const proxied = getNewsImageUrl(avatar);
    if (proxied) return { src: proxied, avatar: true };
  }
  const links = item.extraData?.expanded_urls;
  const linked = Array.isArray(links) && typeof links[0] === 'string' ? links[0] : null;
  const host = hostOf(linked) ?? hostOf(item.url);
  return host ? { src: `https://icons.duckduckgo.com/ip3/${host}.ico`, avatar: false } : null;
}

/**
 * The picture beside a row: the item's own, behind a blur when the source is adult art,
 * or the source's mark when there is none.
 */
export function Thumb({ item, className = 'nw-thumb' }: { item: NewsItem; className?: string }) {
  const [broken, setBroken] = useState(false);
  const [markBroken, setMarkBroken] = useState(false);
  const src = !broken && item.imageUrl ? getNewsImageUrl(item.imageUrl) : null;

  if (src && item.imageIsNsfw) {
    return (
      <span className={className}>
        {/* The blur is a control, and its name is built from the alt text, so a picture
            behind one is named even though the title sits beside it. */}
        <NSFWImage
          src={src}
          alt={item.title}
          imageSexual={2}
          className="h-full w-full object-cover"
          compact
          onError={() => setBroken(true)}
        />
      </span>
    );
  }
  if (src) {
    return (
      <span className={className}>
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
      </span>
    );
  }
  const mark = standInMark(item);
  return (
    <span
      className={`${className} nw-thumb--none${mark?.avatar ? ' nw-thumb--mark' : ''}`}
      aria-hidden="true"
    >
      {mark && !markBroken && (
        <img src={mark.src} alt="" loading="lazy" onError={() => setMarkBroken(true)} />
      )}
    </span>
  );
}

export function HeadlineRow({ item }: { item: NewsItem }) {
  const locale = useLocale();
  const href = safeExternalUrl(item.url);
  const body = bodyAfterTitle(item);

  return (
    <article className="nw-row">
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="nw-row-link"
          aria-label={item.title}
        />
      )}
      <div className="nw-row-body">
        <div className="nw-meta">
          <span className="nameplate nameplate--plain">{plateFor(item, locale)}</span>
          <time dateTime={item.publishedAt}>{clockLabel(item.publishedAt)}</time>
        </div>
        <h3 className="nw-title" lang={JAPANESE.test(item.title) ? 'ja' : undefined}>
          {item.title}
        </h3>
        {body && (
          <p className="nw-summary" lang={JAPANESE.test(body) ? 'ja' : undefined}>
            <LinkifiedText text={body} />
          </p>
        )}
      </div>
      <Thumb item={item} />
    </article>
  );
}
