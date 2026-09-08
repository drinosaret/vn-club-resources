import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { VNTitle } from '@/components/VNTitle';
import { getCoverSrc } from '@/lib/vndb-image-cache';
import type { HotFeedMover } from '@/lib/hot-now';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { RailPanel } from './RailPanel';

const ROWS = 5;

/** How the title moved against the week before, in words: a bare arrow reads as a count. */
function movement(m: HotFeedMover, locale: Locale): string {
  if (m.previous_place === null) return ns(locale, 'rail.hotNow.new');
  const moved = m.placeChange ?? 0;
  if (moved > 0) return ns(locale, 'rail.hotNow.up', { n: moved });
  if (moved < 0) return ns(locale, 'rail.hotNow.down', { n: -moved });
  return ns(locale, 'rail.hotNow.held');
}

/**
 * The week's most-voted titles on the catalogue: the place, the cover, the name, and a line
 * with the week's vote count and how the title moved against the week before.
 */
export function HotNowPanel({ locale, movers }: { locale: Locale; movers: HotFeedMover[] }) {
  const rows = movers.slice(0, ROWS);
  if (rows.length === 0) return null;
  return (
    <RailPanel plate={ns(locale, 'rail.hotNow')} href="/stats/trends/" hrefLabel={ns(locale, 'rail.hotNow.more')}>
      <p className="nw-rail-sub">{ns(locale, 'rail.hotNow.sub')}</p>
      <ol className="nw-release-list">
        {rows.map((m) => {
          const art = getCoverSrc(m.image_url, { width: 128 });
          return (
            <li key={m.id} className="nw-release">
              <Link href={m.href}>
                <span className="rel-row">
                  <span className="rel-art">
                    {art && (
                      <NSFWImage
                        src={art}
                        alt={m.title}
                        vnId={m.id}
                        imageSexual={m.image_sexual ?? 0}
                        className="h-full w-full object-cover object-top"
                        compact
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="rel-title">
                      <span className="nw-mover-place">{m.place}.</span>{' '}
                      <VNTitle title={m.title} title_jp={m.title_jp} title_romaji={m.title_romaji} />
                    </span>
                    <span className="rel-meta">
                      {ns(locale, 'rail.votes', { n: m.current.toLocaleString() })}
                      {' · '}
                      {movement(m, locale)}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </RailPanel>
  );
}
