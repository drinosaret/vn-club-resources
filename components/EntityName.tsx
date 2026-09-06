'use client';

import { useTitlePreference, getEntityDisplayName } from '@/lib/title-preference';

/**
 * A studio's or a person's name, in the script the reader chose.
 *
 * The same delegation the title component makes: the preference lives in the browser, so a
 * server-rendered list hands over the name and nothing else. A credit with no romanisation
 * shows its only name either way.
 *
 * No language is declared on the element. A title's alternate name is Japanese by
 * definition, but a credit's original script is whatever the studio's country writes in,
 * and the payload does not say which.
 */
export function EntityName({
  name,
  original,
  className,
}: {
  name: string;
  original?: string | null;
  className?: string;
}) {
  const { preference } = useTitlePreference();

  return (
    <span className={className}>
      {getEntityDisplayName({ name, original: original ?? undefined }, preference)}
    </span>
  );
}
