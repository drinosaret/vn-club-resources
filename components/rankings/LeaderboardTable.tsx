'use client';

import Link from 'next/link';
import { Trophy, ExternalLink } from 'lucide-react';

import { NSFWImage } from '@/components/NSFWImage';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { getVNDBEntityUrl } from '@/lib/vndb-stats-api';
import {
  getDisplayTitle,
  getEntityDisplayName,
  useTitlePreference,
} from '@/lib/title-preference';
import type { TitlePreference } from '@/lib/title-preference';
import type { LeaderboardRow } from '@/lib/vndb-stats-api';

/**
 * Renders any board.
 *
 * Every subject arrives in the same row shape, so this component never needs to know
 * whether it is showing readers, visual novels or studios. Adding a subject to the
 * catalogue therefore costs nothing here.
 */

interface LeaderboardTableProps {
  rows: LeaderboardRow[];
  /** Highlight one row, used to show a reader where they placed. */
  highlightId?: string | null;
  emptyMessage?: string;
}

/** Medal colouring for the top three. Everything below is plain. */
function rankClasses(rank: number): string {
  if (rank === 1) return 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200';
  if (rank === 2) return 'bg-gray-200 text-gray-700 dark:bg-gray-600/40 dark:text-gray-200';
  if (rank === 3) return 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200';
  return 'text-gray-500 dark:text-gray-400';
}

/**
 * Resolve a row's display name against the reader's title preference.
 *
 * The label the backend sends is the database's own form, which for a Japanese work is the
 * Japanese one. Showing it unconditionally ignores the setting, so titles and names both go
 * through the site's existing helpers here.
 */
function displayNameFor(row: LeaderboardRow, preference: TitlePreference): string {
  if (row.title_jp || row.title_romaji) {
    return getDisplayTitle(
      {
        title: row.label,
        title_jp: row.title_jp ?? undefined,
        title_romaji: row.title_romaji ?? undefined,
      },
      preference,
    );
  }

  if (row.name_original) {
    return getEntityDisplayName({ name: row.label, original: row.name_original }, preference);
  }

  // Usernames have no variants.
  return row.label;
}

function RowContent({ row, name }: { row: LeaderboardRow; name: string }) {
  return (
    <>
      <span
        className={`shrink-0 w-9 h-9 rounded-lg grid place-items-center text-sm font-bold tabular-nums ${rankClasses(row.rank)}`}
      >
        {row.rank}
      </span>

      {row.image_url ? (
        <span className="shrink-0 w-10 h-[3.75rem] rounded-sm overflow-hidden bg-gray-100 dark:bg-gray-700">
          {/* The cover carries no alt text. The title is written beside it, so a screen
              reader would otherwise announce the same name twice, and while the image is
              still loading the browser paints alt text inside the thumbnail box, where a
              wrapped title reads as a rendering fault rather than as a cover. */}
          <NSFWImage
            src={getProxiedImageUrl(row.image_url, 128)}
            alt=""
            imageSexual={row.image_sexual ?? 0}
            vnId={row.image_vn_id ?? undefined}
            className="w-full h-full object-cover"
            compact
          />
        </span>
      ) : null}

      {/* Name and figure share a column on a phone and a line on anything wider.
          Side by side at phone width they compete for the same few hundred pixels: the
          figure spells out both sides of a comparison, wraps to two lines, and leaves the
          name a dozen characters, so a ranking of titles reads as a list of prefixes. Given
          its own line the name gets the full width and the figure loses nothing. */}
      <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
        <span className="min-w-0 sm:flex-1">
          <span className="font-medium text-gray-900 line-clamp-2 sm:block sm:truncate dark:text-white">
            {name}
          </span>
          {row.sublabel ? (
            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
              {row.sublabel}
            </span>
          ) : null}
        </span>

        <span className="mt-0.5 block text-sm font-semibold tabular-nums text-gray-900 sm:mt-0 sm:shrink-0 sm:text-right sm:text-base dark:text-white">
          {row.value_label}
        </span>
      </span>
    </>
  );
}

export function LeaderboardTable({
  rows,
  highlightId,
  emptyMessage = 'Nothing qualifies for this board yet.',
}: LeaderboardTableProps) {
  const { preference } = useTitlePreference();
  if (!rows.length) {
    return (
      <div className="py-16 text-center text-gray-500 dark:text-gray-400">
        <Trophy className="w-8 h-8 mx-auto mb-3 opacity-40" />
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ol className="divide-y divide-gray-100 dark:divide-gray-700/60">
      {rows.map((row) => {
        const highlighted = highlightId && row.id === highlightId;
        // A series row is identified by its franchise but named after one entry, and that
        // entry is what its links point at.
        const vndbUrl = getVNDBEntityUrl(row.image_vn_id ?? row.id);
        const name = displayNameFor(row, preference);

        return (
          <li
            key={`${row.rank}-${row.id}`}
            className={`flex items-center pr-1 ${
              highlighted ? 'bg-primary-50 dark:bg-primary-900/20 rounded-lg' : ''
            } hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors`}
          >
            {/* The VNDB link is a sibling of the row link rather than inside it: an anchor
                cannot be nested in another anchor. */}
            {row.href ? (
              <Link
                href={row.href}
                className="flex items-center gap-2 flex-1 min-w-0 px-2 py-2.5 sm:gap-3 sm:px-3"
              >
                <RowContent row={row} name={name} />
              </Link>
            ) : (
              <div className="flex items-center gap-2 flex-1 min-w-0 px-2 py-2.5 sm:gap-3 sm:px-3">
                <RowContent row={row} name={name} />
              </div>
            )}

            {vndbUrl ? (
              <a
                href={vndbUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${name} on VNDB`}
                aria-label={`Open ${name} on VNDB`}
                className="shrink-0 p-2 rounded-md text-gray-300 dark:text-gray-600 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-white dark:hover:bg-gray-800 focus-visible:text-primary-600 dark:focus-visible:text-primary-400 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
