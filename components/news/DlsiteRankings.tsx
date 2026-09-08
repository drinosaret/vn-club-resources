import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { VNTitle } from '@/components/VNTitle';
import { getCoverSrc, getNewsImageUrl } from '@/lib/vndb-image-cache';
import type { DlsiteRankEntry } from '@/lib/news';
import { shortDay, vnPath } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';

/**
 * One ranked title. A title the catalogue knows links to its page here; any other links
 * to the store. Adult art stays behind the site's blur.
 */
export function RankRow({ entry }: { entry: DlsiteRankEntry }) {
  const internal = vnPath(entry.vnId);
  const art = entry.imageUrl
    ? (getCoverSrc(entry.imageUrl, { width: 128 }) ?? getNewsImageUrl(entry.imageUrl))
    : null;
  const name = entry.vnId ? (
    <VNTitle title={entry.title} title_jp={entry.titleJp} title_romaji={entry.titleRomaji} />
  ) : (
    <span lang="ja">{entry.title}</span>
  );
  const inner = (
    <>
      <span className="nw-rank-no">{entry.rank}</span>
      <span className="nw-rank-art">
        {art && (
          <NSFWImage
            src={art}
            alt={entry.title}
            vnId={entry.vnId ?? undefined}
            imageSexual={entry.imageIsNsfw ? 2 : 0}
            className="h-full w-full object-cover object-top"
            compact
          />
        )}
      </span>
      <span className="nw-rank-text">
        <span className="nw-rank-name">{name}</span>
        {entry.maker && <span className="nw-rank-maker">{entry.maker}</span>}
      </span>
    </>
  );
  return (
    <li className="nw-rank-row">
      {internal ? (
        <Link href={internal} className="nw-rank-link">
          {inner}
        </Link>
      ) : (
        <a href={entry.url} target="_blank" rel="noopener noreferrer" className="nw-rank-link">
          {inner}
        </a>
      )}
    </li>
  );
}

/** The week's adventure-game rankings, commercial brands beside doujin circles. */
export function DlsiteRankings({
  pro,
  maniax,
  asOf,
  limit = 10,
  locale = 'en',
}: {
  pro: DlsiteRankEntry[];
  maniax: DlsiteRankEntry[];
  asOf: string | null;
  limit?: number;
  locale?: Locale;
}) {
  if (pro.length === 0 && maniax.length === 0) return null;
  const stamp = asOf ? shortDay(asOf.slice(0, 10), locale) : null;
  return (
    <section className="nw-ranks" aria-labelledby="dlsite-ranks">
      <div className="nw-group">
        <h3 id="dlsite-ranks" className="nw-group-title">
          {ns(locale, 'ranks.title')}
        </h3>
        <span className="nameplate nameplate--plain">{ns(locale, 'ranks.plate')}</span>
        {stamp && (
          <span className="ml-auto font-mono text-xs text-[color:var(--text-faint)]">
            {ns(locale, 'ranks.asOf', { day: stamp })}
          </span>
        )}
      </div>
      <div className="nw-ranks-grid">
        {pro.length > 0 && (
          <div>
            <p className="nw-rail-sub">{ns(locale, 'ranks.commercial')}</p>
            <ol className="nw-rank-list">
              {pro.slice(0, limit).map((e) => (
                <RankRow key={e.productId} entry={e} />
              ))}
            </ol>
          </div>
        )}
        {maniax.length > 0 && (
          <div>
            <p className="nw-rail-sub">{ns(locale, 'ranks.doujin')}</p>
            <ol className="nw-rank-list">
              {maniax.slice(0, limit).map((e) => (
                <RankRow key={e.productId} entry={e} />
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
