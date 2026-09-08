'use client';

import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { getCoverSrc, getNewsImageUrl } from '@/lib/vndb-image-cache';
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
  stringOrNull,
  vnPath,
  vndbUrl,
  yen,
} from '@/lib/news';
import { useLocale } from '@/lib/i18n/locale-context';
import { ns } from '@/lib/i18n/translations/news';

const JAPANESE = /[぀-ヿ一-鿿]/;

/** What the corner of a tile says: the day it came out, the day it is due, or the cut. */
export type TileBadge = 'day' | 'expected' | 'sale' | 'price';

/**
 * A release as a tile: the cover large, the name under it, the store and the one figure
 * that matters for the block it sits in. A catalogue title links to its page here; a
 * listing the catalogue does not know links to the store and wears the store's picture.
 */
export function ReleaseTile({ item, badge }: { item: NewsItem; badge: TileBadge }) {
  const locale = useLocale();
  const { preference } = useTitlePreference();
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
  const art = item.imageUrl
    ? (getCoverSrc(item.imageUrl, { width: 256 }) ?? getNewsImageUrl(item.imageUrl))
    : null;
  const imageSexual = item.imageIsNsfw ? 2 : (numberOrNull(extra.image_sexual) ?? 0);
  const store = STORE_PLATE[item.source];
  const kind = storeKind(item);
  const vnPageHref = vnPath(item.vnId);
  const storeUrl = safeExternalUrl(item.url);
  // A sale is about the price, so it links to the store's own page rather than the catalogue.
  const saleToStore = (badge === 'sale' || kind === 'sale') && Boolean(storeUrl);
  const href = saleToStore ? storeUrl : (vnPageHref ?? storeUrl);
  const external = saleToStore ? true : !item.vnId;
  const developer = developerNames(item, preference)[0] ?? stringOrNull(extra.maker) ?? stringOrNull(extra.brand);
  const discount = numberOrNull(extra.discount);
  const finalPrice = stringOrNull(extra.final_price) ?? stringOrNull(extra.price);
  const originalPrice = stringOrNull(extra.original_price);
  const minage = numberOrNull(extra.minage);

  let figure: string | null = null;
  if (badge === 'sale') figure = discount ? `-${discount}%` : null;
  else if (badge === 'expected') {
    const due = expectedDate(item);
    figure = due ? (shortDay(due, locale) ?? due) : ns(locale, 'rel.dateTba');
  } else if (badge === 'price') figure = finalPrice ? yen(finalPrice) : null;
  else {
    const released = stringOrNull(extra.released);
    figure = released ? shortDay(released, locale) : null;
  }

  const plate = store
    ? kind === 'released' || badge === 'day'
      ? `${store}${stringOrNull(extra.site) === 'maniax' ? ` · ${ns(locale, 'plate.doujin')}` : ''}`
      : `${store} · ${ns(locale, `kind.${kind}` as 'kind.released')}`
    : 'VNDB';

  const body = (
    <>
      <span className="nw-tile-art">
        {art ? (
          <NSFWImage
            src={art}
            alt={item.title}
            vnId={item.vnId ?? undefined}
            imageSexual={imageSexual}
            className="h-full w-full object-cover object-top"
            compact
          />
        ) : (
          <span className="nw-tile-blank" aria-hidden="true" />
        )}
        {figure && <span className={badge === 'sale' ? 'nw-tile-badge nw-tile-badge--cut' : 'nw-tile-badge'}>{figure}</span>}
      </span>
      <span
        className="nw-tile-title"
        lang={inCatalogue ? (preference === 'japanese' ? 'ja' : undefined) : JAPANESE.test(title) ? 'ja' : undefined}
      >
        {title}
        {minage === 18 && <span className="rel-age">18+</span>}
      </span>
      <span className="nw-tile-meta">
        <span className="nw-tile-store">{plate}</span>
        {developer && <span className="nw-tile-dev">{developer}</span>}
      </span>
      {badge === 'sale' && finalPrice && (
        <span className="nw-tile-price">
          {yen(finalPrice)}
          {originalPrice && <s>{yen(originalPrice)}</s>}
        </span>
      )}
    </>
  );

  return (
    <li className="nw-tile">
      {href ? (
        external ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="nw-tile-link">
            {body}
          </a>
        ) : (
          <Link href={href} className="nw-tile-link">
            {body}
          </Link>
        )
      ) : (
        <span className="nw-tile-link">{body}</span>
      )}
      {saleToStore && vndbUrl(item.vnId) && (
        <a href={vndbUrl(item.vnId) ?? undefined} target="_blank" rel="noopener noreferrer" className="nw-tile-alt">
          {ns(locale, 'link.vnPage')} ↗
        </a>
      )}
    </li>
  );
}
