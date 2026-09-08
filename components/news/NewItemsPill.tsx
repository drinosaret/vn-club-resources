'use client';

import { useLocale } from '@/lib/i18n/locale-context';
import { ns } from '@/lib/i18n/translations/news';

/** The offer of rows that arrived since the page was built; taking it inserts them. */
export function NewItemsPill({ count, onTake }: { count: number; onTake: () => void }) {
  const locale = useLocale();
  if (count === 0) return null;
  return (
    <button type="button" className="nw-pill" onClick={onTake}>
      {count === 1 ? ns(locale, 'river.newItem') : ns(locale, 'river.newItems', { n: count })}
    </button>
  );
}
