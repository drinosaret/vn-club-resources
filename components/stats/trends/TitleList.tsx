'use client';

import Link from 'next/link';

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
      <h3 className="font-semibold text-gray-900 dark:text-white">{heading}</h3>
      <p className="mt-0.5 mb-3 text-xs text-gray-500 dark:text-gray-400">{note}</p>

      {titles.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">{emptyNote}</p>
      ) : (
        <ol className="space-y-2">
          {titles.slice(0, limit).map((entry, index) => (
            <li key={entry.id}>
              <Link
                href={entry.href}
                className="group flex items-center gap-3 rounded-lg p-1.5 -m-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
              >
                <span className="w-4 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-400 dark:text-gray-500">
                  {index + 1}
                </span>
                <span className="relative w-8 h-11 shrink-0 overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
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
                  <span className="block truncate text-sm font-medium text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                    {displayName(entry, preference)}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 tabular-nums">
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
