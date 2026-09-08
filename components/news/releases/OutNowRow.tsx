'use client';

import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { getCoverSrc, getNewsImageUrl } from '@/lib/vndb-image-cache';
import { platformLabel } from '@/lib/platforms';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { yen } from '@/lib/news';
import type { OutNowEntry } from '@/lib/out-now';
import { useLocale } from '@/lib/i18n/locale-context';
import { ns } from '@/lib/i18n/translations/news';

const MAX_PLATFORMS = 3;
const JAPANESE = /[぀-ヿ一-鿿]/;
const COUNT_LOCALE = { en: 'en-US', ja: 'ja-JP' } as const;

/**
 * One title on a day of the out-now list: cover, name in the reader's script, who made it
 * and where it is sold, and whatever figures the row's source carried.
 *
 * A title the catalogue knows links to its page here; a listing the catalogue does not know
 * links to the store it was read from.
 */
export function OutNowRow({ entry }: { entry: OutNowEntry }) {
  const locale = useLocale();
  const { preference } = useTitlePreference();
  const japanese = preference === 'japanese';
  const inCatalogue = Boolean(entry.vnId);

  const title = inCatalogue
    ? getDisplayTitle(
        {
          title: entry.title,
          title_jp: entry.titleJp ?? undefined,
          title_romaji: entry.titleRomaji ?? undefined,
        },
        preference,
      )
    : entry.title;

  const developers = japanese && entry.developersOriginal.length > 0 ? entry.developersOriginal : entry.developers;
  const cover = entry.imageUrl
    ? (getCoverSrc(entry.imageUrl, { width: 128 }) ?? getNewsImageUrl(entry.imageUrl))
    : null;
  const platforms = entry.platforms.slice(0, MAX_PLATFORMS).map((code) => platformLabel(code));
  const facts = [developers[0], platforms.length > 0 ? platforms.join(' · ') : null, entry.price ? yen(entry.price) : null]
    .filter((part): part is string => Boolean(part));

  const body = (
    <span className="rel-row">
      <span className="rel-art">
        {cover && (
          <NSFWImage
            src={cover}
            alt={entry.title}
            vnId={entry.vnId ?? undefined}
            imageSexual={entry.imageSexual}
            className="h-full w-full object-cover object-top"
            compact
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="rel-title"
          lang={inCatalogue ? (japanese ? 'ja' : undefined) : JAPANESE.test(title) ? 'ja' : undefined}
        >
          {title}
          {entry.minage === 18 && <span className="rel-age">18+</span>}
        </span>
        {facts.length > 0 && (
          <span className="rel-meta">
            <span>{facts.join(' · ')}</span>
            {entry.discount !== null && entry.originalPrice && (
              <s className="text-[color:var(--text-faint)]">{yen(entry.originalPrice)}</s>
            )}
          </span>
        )}
        {(entry.store || entry.rating !== null) && (
          <span className="rel-meta">
            {entry.store && <span className="nameplate nameplate--plain">{entry.store}</span>}
            {entry.rating !== null && (
              <span className="rel-score">
                {entry.rating.toFixed(1)} ★
                {entry.votecount !== null &&
                  ` · ${ns(locale, 'rel.votes', { n: entry.votecount.toLocaleString(COUNT_LOCALE[locale]) })}`}
              </span>
            )}
          </span>
        )}
      </span>
    </span>
  );

  if (!entry.href) return <li className="nw-release">{body}</li>;
  return (
    <li className="nw-release">
      {entry.external ? (
        <a href={entry.href} target="_blank" rel="noopener noreferrer">
          {body}
        </a>
      ) : (
        <Link href={entry.href}>{body}</Link>
      )}
    </li>
  );
}
