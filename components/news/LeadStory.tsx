'use client';

import type { NewsItem } from '@/lib/news';
import { clockLabel, safeExternalUrl } from '@/lib/news';
import { useLocale } from '@/lib/i18n/locale-context';
import { bodyAfterTitle, plateFor, Thumb } from './HeadlineRow';
import { LinkifiedText } from './LinkifiedText';

const JAPANESE = /[぀-ヿ一-鿿]/;

/** The newest headline that brought a picture, drawn larger than the rows beneath it. */
export function LeadStory({ item }: { item: NewsItem }) {
  const locale = useLocale();
  const href = safeExternalUrl(item.url);
  const body = bodyAfterTitle(item);

  return (
    <article className="nw-lead">
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="nw-row-link"
          aria-label={item.title}
        />
      )}
      <Thumb item={item} className="nw-lead-art" />
      <div className="nw-row-body">
        <div className="nw-meta">
          <span className="nameplate nameplate--plain">{plateFor(item, locale)}</span>
          <time dateTime={item.publishedAt}>{clockLabel(item.publishedAt)}</time>
        </div>
        <h2 className="nw-lead-title" lang={JAPANESE.test(item.title) ? 'ja' : undefined}>
          {item.title}
        </h2>
        {body && (
          <p className="nw-summary nw-summary--lead" lang={JAPANESE.test(body) ? 'ja' : undefined}>
            <LinkifiedText text={body} />
          </p>
        )}
      </div>
    </article>
  );
}
