'use client';

import { NSFWImage } from '@/components/NSFWImage';
import { VNTitle } from '@/components/VNTitle';
import { getCoverSrc, getNewsImageUrl } from '@/lib/vndb-image-cache';
import type { NewsItem } from '@/lib/news';
import { clockLabel, numberOrNull, safeExternalUrl, stringOrNull, vndbUrl } from '@/lib/news';
import { useLocale } from '@/lib/i18n/locale-context';
import { ns } from '@/lib/i18n/translations/news';
import { Thumb } from './HeadlineRow';

const JAPANESE = /[぀-ヿ一-鿿]/;
const LENGTHS = { short: 'review.length.short', medium: 'review.length.medium', long: 'review.length.long' } as const;

/**
 * A review as a row: the title reviewed, who wrote it and what they gave it, and a few
 * lines of what they said. A review of a catalogue title wears that title's cover and
 * links to the title's catalogue entry beside the link to the review itself.
 */
export function ReviewRow({ item, compact = false }: { item: NewsItem; compact?: boolean }) {
  const locale = useLocale();
  const extra = item.extraData ?? {};
  const href = safeExternalUrl(item.url);
  const catalogue = vndbUrl(item.vnId);
  const reviewer = stringOrNull(extra.reviewer) ?? stringOrNull(extra.creator);
  const reviewerHref = safeExternalUrl(stringOrNull(extra.reviewer_url));
  const vote = numberOrNull(extra.vote);
  const length = stringOrNull(extra.length) as keyof typeof LENGTHS | null;
  const imageSexual = item.imageIsNsfw ? 2 : (numberOrNull(extra.image_sexual) ?? 0);
  const cover = item.vnId && item.imageUrl
    ? (getCoverSrc(item.imageUrl, { width: 128 }) ?? getNewsImageUrl(item.imageUrl))
    : null;
  const body = item.summary?.trim() || null;

  return (
    <article className={compact ? 'nw-row nw-row--compact' : 'nw-row'}>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="nw-row-link" aria-label={item.title} />
      )}
      <div className="nw-row-body">
        <div className="nw-meta">
          <span className="nameplate nameplate--plain">{item.sourceLabel}</span>
          {reviewer &&
            (reviewerHref ? (
              <a href={reviewerHref} target="_blank" rel="noopener noreferrer" className="nw-review-by">
                {reviewer}
              </a>
            ) : (
              <span className="nw-review-by">{reviewer}</span>
            ))}
          {vote !== null && <span className="nw-review-vote">{ns(locale, 'review.vote', { n: vote })}</span>}
          {length && LENGTHS[length] && <span className="nw-review-len">{ns(locale, LENGTHS[length])}</span>}
          {/* The catalogue site dates reviews to the day; a clock would be invented. */}
          {item.source !== 'vndb_review' && (
            <time dateTime={item.publishedAt}>{clockLabel(item.publishedAt)}</time>
          )}
        </div>
        <h3 className="nw-title" lang={!item.vnId && JAPANESE.test(item.title) ? 'ja' : undefined}>
          {item.vnId ? (
            <VNTitle
              title={item.title}
              title_jp={stringOrNull(extra.alttitle)}
              title_romaji={stringOrNull(extra.title_romaji)}
            />
          ) : (
            item.title
          )}
        </h3>
        {!compact && body && (
          <p className="nw-summary nw-summary--review" lang={JAPANESE.test(body) ? 'ja' : undefined}>
            {body}
          </p>
        )}
        {catalogue && !compact && (
          <a href={catalogue} target="_blank" rel="noopener noreferrer" className="nw-review-vn">
            {ns(locale, 'link.vnPage')} ↗
          </a>
        )}
      </div>
      {cover ? (
        <span className="nw-thumb nw-thumb--cover">
          <NSFWImage
            src={cover}
            alt={item.title}
            vnId={item.vnId ?? undefined}
            imageSexual={imageSexual}
            className="h-full w-full object-cover object-top"
            compact
          />
        </span>
      ) : (
        <Thumb item={item} className="nw-thumb nw-review-art" />
      )}
    </article>
  );
}
