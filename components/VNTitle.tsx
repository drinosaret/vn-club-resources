'use client';

import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';

/**
 * A visual novel's name, in the script the reader chose.
 *
 * Server-rendered lists cannot read the preference, which lives in the browser, so they either
 * hard-code a script or delegate the name itself. This is the delegation: the surrounding list
 * stays on the server and only the name hydrates.
 *
 * The provider starts at the romanised default and reads the stored choice before paint, so the
 * server and the first client render agree and the swap costs no layout shift.
 */
export function VNTitle({
  title,
  title_jp,
  title_romaji,
  className,
}: {
  title: string;
  title_jp?: string | null;
  title_romaji?: string | null;
  className?: string;
}) {
  const { preference } = useTitlePreference();
  const name = getDisplayTitle(
    { title, title_jp: title_jp ?? undefined, title_romaji: title_romaji ?? undefined },
    preference,
  );

  // The element is marked as Japanese only when it is, so a screen reader does not change voice
  // for a romanisation.
  return (
    <span className={className} lang={preference === 'japanese' ? 'ja' : undefined}>
      {name}
    </span>
  );
}
