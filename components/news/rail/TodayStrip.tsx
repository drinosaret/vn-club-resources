'use client';

import type { NewsItem } from '@/lib/news';
import { safeExternalUrl, shortDay, stringOrNull, vnPath } from '@/lib/news';
import type { UpcomingRelease } from '@/lib/upcoming-releases';
import { formatReleaseDayBadge } from '@/lib/upcoming-releases';
import { getCoverSrc, getNewsImageUrl } from '@/lib/vndb-image-cache';
import { VNTitle } from '@/components/VNTitle';
import { useLocale } from '@/lib/i18n/locale-context';
import { ns } from '@/lib/i18n/translations/news';
import { StripCover } from '../modules/StripCover';

const MAX_PER_GROUP = 6;

/**
 * The day's releases and what is coming, as one scrolling row of covers above the stream.
 * Only on a narrow screen, where the two rail panels it stands in for are left out.
 */
export function TodayStrip({
  today,
  tomorrow,
  upcoming,
}: {
  today: NewsItem[];
  tomorrow: NewsItem[];
  upcoming: UpcomingRelease[];
}) {
  const locale = useLocale();
  const out = today.slice(0, MAX_PER_GROUP);
  const next = tomorrow.slice(0, MAX_PER_GROUP);
  const coming = upcoming.filter((u) => u.date_precision === 'day').slice(0, MAX_PER_GROUP);
  if (out.length === 0 && next.length === 0 && coming.length === 0) return null;

  const release = (item: NewsItem, badge: string) => {
    const internal = vnPath(item.vnId);
    const art = getCoverSrc(item.imageUrl, { width: 128 }) ?? (item.imageUrl ? getNewsImageUrl(item.imageUrl) : null);
    return (
      <StripCover
        key={item.id}
        href={internal ?? safeExternalUrl(item.url) ?? null}
        external={!internal}
        art={art}
        alt={item.title}
        vnId={item.vnId ?? undefined}
        imageSexual={item.imageIsNsfw ? 2 : 0}
        title={
          item.vnId ? (
            <VNTitle title={item.title} title_jp={stringOrNull(item.extraData?.alttitle)} title_romaji={stringOrNull(item.extraData?.title_romaji)} />
          ) : (
            item.title
          )
        }
        badge={badge}
      />
    );
  };

  return (
    <div className="nw-strip-mobile nw-rail--first">
      {(out.length > 0 || next.length > 0) && (
        <>
          <span className="nw-strip-label">{ns(locale, 'strip.today')}</span>
          <ul className="nw-strip nw-strip--covers">
            {out.map((item) => release(item, ns(locale, 'rail.today')))}
            {next.map((item) => release(item, ns(locale, 'strip.tomorrow')))}
          </ul>
        </>
      )}
      {coming.length > 0 && (
        <>
          <span className="nw-strip-label">{ns(locale, 'strip.comingUp')}</span>
          <ul className="nw-strip nw-strip--covers">
            {coming.map((u) => (
              <StripCover
                key={u.id}
                href={vnPath(u.id) ?? `/vn/${u.id}/`}
                art={getCoverSrc(u.image_url, { width: 128 })}
                alt={u.title}
                vnId={u.id}
                imageSexual={u.image_sexual ?? 0}
                title={<VNTitle title={u.title} title_jp={u.title_jp} title_romaji={u.title_romaji} />}
                badge={formatReleaseDayBadge(u, locale) || shortDay(u.released, locale)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
