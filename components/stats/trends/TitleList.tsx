'use client';

import Link from '@/components/Link';

import { NSFWImage } from '@/components/NSFWImage';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { getDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import type { TitlePreference } from '@/lib/title-preference';
import type { ExplorerTitle } from '@/lib/vndb-stats-api';

/**
 * A short ranked list of titles, as both explorers render them.
 *
 * Shared rather than duplicated because the two explorers sit on the same page and any
 * divergence in how a cover or a rank is drawn reads as a bug rather than as variety.
 */

/** The backend sends every title form; which to show is a per-reader setting. */
export function displayName(entry: ExplorerTitle, preference: TitlePreference): string {
  return getDisplayTitle(
    {
      title: entry.title,
      title_jp: entry.title_jp ?? undefined,
      title_romaji: entry.title_romaji ?? undefined,
    },
    preference,
  );
}

interface TitleListProps {
  heading: string;
  note: string;
  titles: ExplorerTitle[];
  emptyNote: string;
  limit?: number;
}

export function TitleList({ heading, note, titles, emptyNote, limit = 5 }: TitleListProps) {
  const { preference } = useTitlePreference();

  return (
    <div>
      <h3 className="st-card-title">{heading}</h3>
      <p className="st-card-sub mb-3 mt-0.5">{note}</p>

      {titles.length === 0 ? (
        <p className="st-card-sub italic">{emptyNote}</p>
      ) : (
        <ol className="space-y-2">
          {titles.slice(0, limit).map((entry, index) => (
            <li key={entry.id}>
              <Link
                href={entry.href}
                className="dg-row st-mid group"
              >
                <span className="dg-rank">
                  {index + 1}
                </span>
                <span className="relative h-11 w-8 shrink-0 overflow-hidden rounded-xs border border-[color:var(--rule)] bg-[color:var(--surface-inset)]">
                  {entry.image_url ? (
                    <NSFWImage
                      src={getProxiedImageUrl(entry.image_url, 128)}
                      alt=""
                      vnId={entry.id}
                      imageSexual={entry.image_sexual ?? 0}
                      className="w-full h-full object-cover"
                      compact
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="dg-name block">
                    {displayName(entry, preference)}
                  </span>
                  <span className="block truncate font-mono text-xs tabular-nums text-[color:var(--text-faint)]">
                    {entry.value_label}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
