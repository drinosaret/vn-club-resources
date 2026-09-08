'use client';

import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { getCoverSrc, getNewsImageUrl } from '@/lib/vndb-image-cache';
import { platformLabel } from '@/lib/platforms';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import type { NewsItem } from '@/lib/news';
import {
  STORE_PLATE,
  developerNames,
  expectedDate,
  numberOrNull,
  safeExternalUrl,
  shortDay,
  storeKind,
  stringArray,
  stringOrNull,
  vnPath,
  vndbUrl,
  yen,
} from '@/lib/news';
import { useLocale } from '@/lib/i18n/locale-context';
import { ns } from '@/lib/i18n/translations/news';

const MAX_PLATFORMS = 3;
const JAPANESE = /[぀-ヿ一-鿿]/;

/**
 * A release as a row: cover, name in the reader's script, studio and platforms, and the day.
 *
 * A storefront copy links to the site's own page for the title, with the store named on a
 * plate, so a title that reaches two stores in a week reads as one thing twice rather
 * than as two things. A store listing the catalogue does not know is a row of its own,
 * with the store's title and picture, linking to the store.
 */
export function ReleaseRow({ item, badge }: { item: NewsItem; badge?: 'day' | 'sale' }) {
  const locale = useLocale();
  const { preference } = useTitlePreference();
  const dayBadge = (value: string | null) => (value ? shortDay(value, locale) : null);
  const extra = item.extraData ?? {};
  const inCatalogue = Boolean(item.vnId);
  const title = inCatalogue
    ? getDisplayTitle(
        {
          title: item.title,
          title_jp: stringOrNull(extra.alttitle) ?? undefined,
          title_romaji: stringOrNull(extra.title_romaji) ?? undefined,
        },
        preference,
      )
    : item.title;
  const developers = developerNames(item, preference);
  const platforms = stringArray(extra.platforms).slice(0, MAX_PLATFORMS);
  const minage = numberOrNull(extra.minage);
  const imageSexual = item.imageIsNsfw ? 2 : (numberOrNull(extra.image_sexual) ?? 0);
  const cover = item.imageUrl
    ? (getCoverSrc(item.imageUrl, { width: 128 }) ?? getNewsImageUrl(item.imageUrl))
    : null;
  const store = STORE_PLATE[item.source];
  const kind = storeKind(item);
  const internal = vnPath(item.vnId);
  const external = safeExternalUrl(item.url);
  const discount = numberOrNull(extra.discount);
  const finalPrice = stringOrNull(extra.final_price) ?? stringOrNull(extra.price);
  const originalPrice = stringOrNull(extra.original_price);
  const expected = expectedDate(item);
  const site = stringOrNull(extra.site);
  const releasedOn = stringOrNull(extra.released);
  const firstReleased = stringOrNull(extra.vn_released);
  // A release dated after the title's own first release is an edition, port or re-release.
  const newEdition = Boolean(releasedOn && firstReleased && firstReleased < releasedOn);
  const releaseEntries = Array.isArray(extra.releases)
    ? (extra.releases as { id?: unknown; title?: unknown }[]).filter((r) => typeof r.id === 'string' && /^r\d+$/.test(r.id))
    : [];
  const releaseEntry = releaseEntries[0] as { id: string; title?: string } | undefined;
  const editionTitle = typeof releaseEntry?.title === 'string' ? releaseEntry.title : null;

  // The plate names the store and, where the row is not a plain release, what kind of
  // listing it is, so a pre-order and a sale never read as something out today.
  const plate = store
    ? kind === 'released'
      ? `${store}${site === 'maniax' ? ` · ${ns(locale, 'plate.doujin')}` : ''}`
      : `${store} · ${ns(locale, `kind.${kind}` as 'kind.released')}`
    : newEdition
      ? ns(locale, 'plate.newEdition')
      : null;

  let when: string | null;
  if (kind === 'sale' || badge === 'sale') {
    when = discount ? `-${discount}%` : null;
  } else if (kind === 'announced' || kind === 'preorder') {
    when = expected ? (dayBadge(expected) ?? expected) : dayBadge(stringOrNull(extra.released));
  } else {
    when = dayBadge(stringOrNull(extra.released));
  }

  const body = (
    <span className="rel-row">
      <span className="rel-art">
        {cover && (
          <NSFWImage
            src={cover}
            alt={item.title}
            vnId={item.vnId ?? undefined}
            imageSexual={imageSexual}
            className="h-full w-full object-cover object-top"
            compact
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="rel-title"
          lang={inCatalogue ? (preference === 'japanese' ? 'ja' : undefined) : JAPANESE.test(title) ? 'ja' : undefined}
        >
          {title}
          {minage === 18 && <span className="rel-age">18+</span>}
        </span>
        <span className="rel-meta">
          {plate && <span className="nameplate nameplate--plain mr-2 align-middle">{plate}</span>}
          {developers.length > 0 ? (
            <span className="rel-maker">{developers.slice(0, 2).join(', ')}</span>
          ) : null}
        </span>
        {(kind === 'sale' || badge === 'sale') && finalPrice && (
          <span className="rel-meta font-mono tabular-nums">
            {yen(finalPrice)}
            {originalPrice && (
              <span className="ml-2 line-through text-[color:var(--text-faint)]">{yen(originalPrice)}</span>
            )}
          </span>
        )}
        {kind === 'preorder' && finalPrice && (
          <span className="rel-meta font-mono tabular-nums">{yen(finalPrice)}</span>
        )}
        {editionTitle && editionTitle !== item.title && (
          <span className="rel-meta" lang="ja">
            {editionTitle}
            {releaseEntries.length > 1 && ` +${releaseEntries.length - 1}`}
          </span>
        )}
        {platforms.length > 0 && kind === 'released' && (
          <span className="rel-meta">{platforms.map((code) => platformLabel(code)).join(' · ')}</span>
        )}
      </span>
      {when && <span className="rel-when">{when}</span>}
    </span>
  );

  // A sale is about the price, so it links to the store's own page rather than the catalogue.
  const saleToStore = (kind === 'sale' || badge === 'sale') && Boolean(external);

  if (saleToStore) {
    return (
      <li className="nw-release">
        <a href={external} target="_blank" rel="noopener noreferrer">
          {body}
        </a>
        {vndbUrl(item.vnId) && (
          <a href={vndbUrl(item.vnId) ?? undefined} target="_blank" rel="noopener noreferrer" className="nw-release-store">
            {ns(locale, 'link.vnPage')} ↗
          </a>
        )}
      </li>
    );
  }
  if (internal) {
    return (
      <li className="nw-release">
        <Link href={internal}>{body}</Link>
        {store && external && (
          <a
            href={external}
            target="_blank"
            rel="noopener noreferrer"
            className="nw-release-store"
          >
            {ns(locale, 'link.storePage', { store })} ↗
          </a>
        )}
        {!store && releaseEntry && (
          <a
            href={`https://vndb.org/${releaseEntry.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="nw-release-store"
          >
            {ns(locale, 'link.vndbRelease')} ↗
          </a>
        )}
      </li>
    );
  }
  if (external) {
    return (
      <li className="nw-release">
        <a href={external} target="_blank" rel="noopener noreferrer">
          {body}
        </a>
      </li>
    );
  }
  return <li className="nw-release">{body}</li>;
}
