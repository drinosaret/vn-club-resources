'use client';

import { useState, useMemo } from 'react';
import Link from '@/components/Link';
import type { TopVN } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { LanguageFilter, LanguageFilterValue, filterByLanguage } from './LanguageFilter';
import { useTitlePreference, getDisplayTitle, type TitlePreference } from '@/lib/title-preference';
import { NSFWImage } from '@/components/NSFWImage';
import { useImageFade } from '@/hooks/useImageFade';

interface TopVNsTableProps {
  title: string;
  /** The ranking across every language. */
  vns: TopVN[];
  /**
   * The same ranking computed over Japanese-original titles only.
   *
   * A separate list rather than a filter over the one above: filtering a top ten leaves
   * however many entries happen to survive, which is not a top ten of anything. Both lists
   * are held so the toggle stays instant.
   */
  japaneseVns?: TopVN[];
  showRating?: boolean;
  showVotes?: boolean;
}

export function TopVNsTable({
  title,
  vns,
  japaneseVns,
  showRating = true,
  showVotes = true,
}: TopVNsTableProps) {
  const [langFilter, setLangFilter] = useState<LanguageFilterValue>('ja');
  const { preference } = useTitlePreference();

  const filteredVNs = useMemo(() => {
    // Fall back to filtering only where no Japanese-only ranking was supplied, so callers
    // that pass one list keep working.
    const chosen =
      langFilter === 'all'
        ? vns
        : japaneseVns ?? vns.filter((vn) => filterByLanguage(vn, langFilter));
    return chosen.map((vn, idx) => ({ ...vn, rank: idx + 1 }));
  }, [vns, japaneseVns, langFilter]);

  if (vns.length === 0) {
    return null;
  }

  return (
    <div className="st-card overflow-hidden">
      <div className="st-card-head border-b border-[color:var(--rule)] px-4 py-3">
        <h3 className="st-card-title">{title}</h3>
        <LanguageFilter value={langFilter} onChange={setLangFilter} />
      </div>

      {filteredVNs.length === 0 ? (
        <div className="px-4 py-8 text-center text-[color:var(--nezu)] text-sm">
          No Japanese VNs in this list. Try switching to &quot;All Languages&quot;.
        </div>
      ) : (
        <div className="divide-y divide-[color:var(--rule)]">
          {filteredVNs.map((vn) => (
            <TopVNRow key={vn.id} vn={vn} showRating={showRating} showVotes={showVotes} preference={preference} />
          ))}
        </div>
      )}
    </div>
  );
}

function TopVNRow({ vn, showRating, showVotes, preference }: { vn: TopVN & { rank: number }; showRating: boolean; showVotes: boolean; preference: TitlePreference }) {
  const { onLoad, shimmerClass, fadeClass } = useImageFade();

  return (
    <Link
      href={`/vn/${vn.id}`}
      className="group flex items-center gap-3 px-4 py-2.5"
    >
      {/* Rank */}
      <span className="dg-rank">{vn.rank}</span>

      {/* Cover thumbnail */}
      <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-xs border border-[color:var(--rule)] bg-[color:var(--surface-inset)]">
        {vn.image_url ? (
          <>
            <div className={shimmerClass} />
            <NSFWImage
              src={getProxiedImageUrl(vn.image_url, { width: 128, vnId: vn.id })}
              alt={getDisplayTitle({ title: vn.title, title_jp: vn.alttitle, title_romaji: vn.title_romaji }, preference)}
              vnId={vn.id}
              imageSexual={vn.image_sexual}
              className={`w-full h-full object-cover object-top ${fadeClass}`}
              loading="lazy"
              onLoad={onLoad}
              onError={onLoad}
              compact
            />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[color:var(--text-faint)]">
          </div>
        )}
      </div>

      {/* Title and figures share a column on a phone and a line on anything wider. Side by
          side at phone width the vote count and the rating hold a quarter of the row, leaving
          the title around a dozen characters, so a ranking of titles reads as a list of
          prefixes. Given its own line the title takes the full width and the figures lose
          nothing. */}
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
        <div className="min-w-0 sm:flex-1">
          <p className="dg-name line-clamp-2 dg-name--wrap">
            {getDisplayTitle({ title: vn.title, title_jp: vn.alttitle, title_romaji: vn.title_romaji }, preference)}
          </p>
        </div>

        <div className="mt-0.5 flex items-center gap-4 text-sm sm:mt-0 sm:shrink-0">
          {showVotes && vn.votecount !== undefined && (
            <span className="st-num text-[color:var(--text-faint)]">
              {vn.votecount.toLocaleString()}
            </span>
          )}
          {showRating && vn.rating !== undefined && (
            <span className="st-num text-[color:var(--ink)]">{vn.rating.toFixed(2)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
