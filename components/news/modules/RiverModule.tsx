'use client';

import Link from '@/components/Link';
import type { NewsItem } from '@/lib/news';
import { newsPath } from '@/lib/news';
import { useLocale } from '@/lib/i18n/locale-context';
import { ns } from '@/lib/i18n/translations/news';
import { TrailersStrip } from './TrailersStrip';
import { CoverStrip } from './CoverStrip';
import { ReviewsTrio } from './ReviewsTrio';

export type ModuleKind = 'trailers' | 'covers' | 'reviews';

const MORE: Record<ModuleKind, string> = {
  trailers: '/news/trailers/',
  covers: '/news/recently-added/',
  reviews: '/news/reviews/',
};

/** A strip or a trio set into the river, with a heading and the way to its section. */
export function RiverModule({ kind, items }: { kind: ModuleKind; items: NewsItem[] }) {
  const locale = useLocale();
  if (items.length === 0) return null;
  return (
    <aside className="nw-module" aria-label={ns(locale, `module.${kind}`)}>
      <div className="nw-module-head">
        <span className="nw-module-title">{ns(locale, `module.${kind}`)}</span>
        <Link href={newsPath(locale, MORE[kind])} className="nw-module-more">
          {ns(locale, 'module.more')}
          <span aria-hidden> →</span>
        </Link>
      </div>
      {kind === 'trailers' && <TrailersStrip items={items} />}
      {kind === 'covers' && <CoverStrip items={items} />}
      {kind === 'reviews' && <ReviewsTrio items={items} />}
    </aside>
  );
}
