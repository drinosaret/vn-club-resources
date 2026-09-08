import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { VNTitle } from '@/components/VNTitle';
import { getCoverSrc } from '@/lib/vndb-image-cache';
import type { RailVN } from '@/lib/news';
import { vnPath } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { RailPanel } from './RailPanel';

/** The titles that drew the most reviews in the last month. */
export function MostReviewedPanel({ locale, items }: { locale: Locale; items: RailVN[] }) {
  if (items.length === 0) return null;
  return (
    <RailPanel plate={ns(locale, 'rail.mostReviewed')}>
      <p className="nw-rail-sub">{ns(locale, 'rail.mostReviewed.sub')}</p>
      <ol className="nw-release-list">
        {items.map((vn) => {
          const href = vnPath(vn.vnId);
          const art = getCoverSrc(vn.imageUrl, { width: 128 });
          const body = (
            <span className="rel-row">
              <span className="rel-art">
                {art && (
                  <NSFWImage
                    src={art}
                    alt={vn.title}
                    vnId={vn.vnId}
                    imageSexual={vn.imageIsNsfw ? 2 : 0}
                    className="h-full w-full object-cover object-top"
                    compact
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="rel-title">
                  <VNTitle title={vn.title} title_jp={vn.titleJp} />
                </span>
              </span>
              <span className="nw-count">
                {vn.count === 1 ? ns(locale, 'rail.reviewCountOne') : ns(locale, 'rail.reviewCount', { n: vn.count })}
              </span>
            </span>
          );
          return (
            <li key={vn.vnId} className="nw-release">
              {href ? <Link href={href}>{body}</Link> : body}
            </li>
          );
        })}
      </ol>
    </RailPanel>
  );
}
