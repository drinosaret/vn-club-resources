import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { VNTitle } from '@/components/VNTitle';
import { EntityName } from '@/components/EntityName';
import { getCoverSrc } from '@/lib/vndb-image-cache';
import { formatReleaseDayBadge, type UpcomingRelease } from '@/lib/upcoming-releases';
import { platformLabel } from '@/lib/platforms';
import { newsPath, vnPath } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { RailPanel } from './RailPanel';

const MAX_ROWS = 5;

/** The next announced titles with a day to their date, as the schedule page lists them. */
export function ComingUpPanel({ locale, items }: { locale: Locale; items: UpcomingRelease[] }) {
  const rows = items.filter((i) => i.date_precision === 'day').slice(0, MAX_ROWS);
  if (rows.length === 0) return null;
  return (
    <RailPanel
      plate={ns(locale, 'rail.comingUp')}
      href={newsPath(locale, '/news/upcoming/')}
      hrefLabel={ns(locale, 'rail.comingUp.more')}
      hideNarrow
    >
      <ul className="nw-release-list">
        {rows.map((item) => {
          const art = getCoverSrc(item.image_url, { width: 128 });
          const href = vnPath(item.id) ?? `/vn/${item.id}/`;
          const studio = item.developers[0];
          return (
            <li key={item.id} className="nw-release">
              <Link href={href}>
                <span className="rel-row">
                  <span className="rel-art">
                    {art && (
                      <NSFWImage
                        src={art}
                        alt={item.title}
                        vnId={item.id}
                        imageSexual={item.image_sexual ?? 0}
                        className="h-full w-full object-cover object-top"
                        compact
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="rel-title">
                      <VNTitle title={item.title} title_jp={item.title_jp} title_romaji={item.title_romaji} />
                      {item.minage === 18 && <span className="rel-age">18+</span>}
                    </span>
                    {(studio || item.platforms.length > 0) && (
                      <span className="rel-meta">
                        {studio ? <EntityName name={studio.name} original={studio.original} /> : null}
                        {studio && item.platforms.length > 0 ? ' · ' : null}
                        {item.platforms.slice(0, 2).map((code) => platformLabel(code)).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="rel-when">{formatReleaseDayBadge(item, locale)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </RailPanel>
  );
}
