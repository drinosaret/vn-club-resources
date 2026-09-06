'use client';

import Link from '@/components/Link';
import { useTitlePreference, getDisplayTitle, getEntityDisplayName } from '@/lib/title-preference';
import { NSFWImage } from '@/components/NSFWImage';
import { getCoverSrc } from '@/lib/vndb-image-cache';
import { useImageFade } from '@/hooks/useImageFade';
import { stripBBCode } from '@/lib/bbcode';
import type { ClubPick } from '@/lib/events';

const KIND = {
  month: { label: 'VN of the Month' },
  season: { label: 'VN of the Season' },
} as const;

/** Home-page card for the monthly/seasonal pick, mirroring the VN of the Day card
 *  (score, developer, tags, EN/JP titles). Shows a placeholder when none is set. */
export function ClubPickCard({ pick, kind }: { pick: ClubPick | null; kind: 'month' | 'season' }) {
  const { preference } = useTitlePreference();
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  const meta = KIND[kind];

  if (!pick) {
    return (
      <div className="panel h-full flex flex-col p-5 pt-7 md:p-6 md:pt-7">
        <h3 className="nameplate dg-plate">{meta.label}</h3>
        <p className="text-sm text-[color:var(--text-faint)]">
          Not picked yet. The club votes on it before the period starts.
        </p>
      </div>
    );
  }

  const { vn, period } = pick;
  const numericId = (vn.id || '').replace(/\D/g, '');
  const vnUrl = `/vn/${numericId}/`;
  const displayTitle = getDisplayTitle(
    { title: vn.title, title_jp: vn.title_jp, title_romaji: vn.title_romaji },
    preference,
  );
  const imageUrl = getCoverSrc(vn.image_url, { width: 256 });
  const description = vn.description ? stripBBCode(vn.description).replace(/\n+/g, ' ').trim() : null;
  const developers = (vn.developers ?? []).map((d) => getEntityDisplayName(d, preference));
  // The home page carries no reveal control, so a tag is eligible only when it is
  // free of a spoiler flag and outside the sexual category.
  const tags = (vn.tags ?? []).filter((t) => t.spoiler === 0 && t.category !== 'ero');

  return (
    <div className="panel h-full p-5 pt-7 md:p-6 md:pt-7">
      <h3 className="nameplate dg-plate">{meta.label}</h3>
      <div className="flex flex-col sm:flex-row gap-5 md:gap-6 h-full">
        {/* Cover */}
        <Link href={vnUrl} className="shelf-item shrink-0 self-center sm:self-start">
          <span className="shelf-art w-[140px] sm:w-[160px] md:w-[180px]">
            <div className={shimmerClass} />
            {imageUrl ? (
              <NSFWImage
                src={imageUrl}
                alt={vn.title}
                imageSexual={vn.image_sexual ?? null}
                vnId={vn.id}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${fadeClass}`}
                loading="lazy"
                onLoad={onLoad}
              />
            ) : (
              <div className="absolute inset-0 bg-[color:var(--surface-inset)]" />
            )}
          </span>
        </Link>

        {/* Info */}
        <div className="flex flex-col min-w-0 flex-1">
          {period && (
            <div className="mb-2 font-mono text-xs text-[color:var(--text-faint)]">{period}</div>
          )}

          {/* Title */}
          <Link href={vnUrl} className="pick-title">
            <h3 className="line-clamp-2">{displayTitle}</h3>
          </Link>

          {/* Rating + Developer */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-[color:var(--nezu)]">
            {vn.rating != null && vn.votecount != null && (
              <span className="inline-flex items-baseline gap-1.5">
                <span className="font-mono font-medium tabular-nums text-[color:var(--ink)]">
                  {vn.rating.toFixed(2)}
                </span>
                <span className="text-xs">({vn.votecount.toLocaleString()} votes)</span>
              </span>
            )}
            {developers.length > 0 && <span className="truncate">{developers.slice(0, 2).join(', ')}</span>}
          </div>

          {/* Description */}
          {description && (
            <p className="text-sm text-[color:var(--text-secondary)] mt-2 line-clamp-2 leading-relaxed">
              {description}
            </p>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {tags.slice(0, 4).map((tag) => (
                <span
                  key={tag.name}
                  className="px-2 py-0.5 rounded-xs text-xs border border-[color:var(--rule)] text-[color:var(--nezu)]"
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {/* CTA */}
          <Link
            href={vnUrl}
            aria-label={`View details for ${displayTitle}`}
            className="sec-more mt-3 md:mt-auto pt-1"
          >
            View details
            <span aria-hidden>&rarr;</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
