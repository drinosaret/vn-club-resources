'use client';

import Link from 'next/link';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import type { ExampleSentence } from '@/lib/word-of-the-day';

export function WotdSentenceSource({ sentence }: { sentence: ExampleSentence }) {
  const { preference } = useTitlePreference();

  const sourceName = sentence.source_title || sentence.source_english;
  if (!sourceName) return null;

  // Use resolved VN title data with preference if available
  const displayName = sentence.vn_title
    ? getDisplayTitle(
        { title: sentence.vn_title, title_jp: sentence.vn_title_jp ?? undefined, title_romaji: sentence.vn_title_romaji ?? undefined },
        preference,
      )
    : sourceName;

  return (
    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
      Source:{' '}
      {sentence.vn_id ? (
        <Link
          href={`/vn/${sentence.vn_id}/`}
          className="underline hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
        >
          {displayName}
        </Link>
      ) : (
        <span>{displayName}</span>
      )}
      {sentence.source_type && sentence.source_type !== 'Visual Novel' && ` (${sentence.source_type})`}
    </p>
  );
}
