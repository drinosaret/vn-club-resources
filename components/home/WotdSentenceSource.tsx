'use client';

import Link from '@/components/Link';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import type { ExampleSentence } from '@/lib/word-of-the-day';

export function WotdSentenceSource({
  sentence,
  className = 'text-xs text-[color:var(--text-faint)] mt-1',
}: {
  sentence: ExampleSentence;
  className?: string;
}) {
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
    <p className={className}>
      Source:{' '}
      {sentence.vn_id ? (
        <Link
          href={`/vn/${sentence.vn_id}/`}
          className="underline underline-offset-2 transition-colors hover:text-[color:var(--ai)] dark:hover:text-[color:var(--kohaku)]"
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
