import type { DlsiteRankEntry } from '@/lib/news';
import { shortDay } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { RankRow } from './DlsiteRankings';

/** The retailer's pre-order and sales rankings for PC games, side by side. */
export function GetchuRankings({
  reserve,
  sales,
  asOf,
  limit = 10,
  locale = 'en',
}: {
  reserve: DlsiteRankEntry[];
  sales: DlsiteRankEntry[];
  asOf: string | null;
  limit?: number;
  locale?: Locale;
}) {
  if (reserve.length === 0 && sales.length === 0) return null;
  const stamp = asOf ? shortDay(asOf.slice(0, 10), locale) : null;
  return (
    <section className="nw-ranks" aria-labelledby="getchu-ranks">
      <div className="nw-group">
        <h3 id="getchu-ranks" className="nw-group-title">
          {ns(locale, 'ranks.getchu.title')}
        </h3>
        <span className="nameplate nameplate--plain">{ns(locale, 'ranks.getchu.plate')}</span>
        {stamp && (
          <span className="ml-auto font-mono text-xs text-[color:var(--text-faint)]">
            {ns(locale, 'ranks.asOf', { day: stamp })}
          </span>
        )}
      </div>
      <div className="nw-ranks-grid">
        {reserve.length > 0 && (
          <div>
            <p className="nw-rail-sub">{ns(locale, 'ranks.getchu.reserve')}</p>
            <ol className="nw-rank-list">
              {reserve.slice(0, limit).map((e) => (
                <RankRow key={e.productId} entry={e} />
              ))}
            </ol>
          </div>
        )}
        {sales.length > 0 && (
          <div>
            <p className="nw-rail-sub">{ns(locale, 'ranks.getchu.sales')}</p>
            <ol className="nw-rank-list">
              {sales.slice(0, limit).map((e) => (
                <RankRow key={e.productId} entry={e} />
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
