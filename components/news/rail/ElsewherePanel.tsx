import Link from '@/components/Link';
import type { RailSectionItems } from '@/lib/news';
import { newsPath } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { LineRow } from '../LineRow';
import { RailPanel } from './RailPanel';

/** The newest few rows of every other section, each under a label that leads there. */
export function ElsewherePanel({ locale, sections }: { locale: Locale; sections: RailSectionItems[] }) {
  const filled = sections.filter((s) => s.items.length > 0);
  if (filled.length === 0) return null;
  return (
    <RailPanel plate={ns(locale, 'rail.elsewhere')}>
      {filled.map((s) => (
        <div key={s.section}>
          <p className="nw-elsewhere-sec">
            <Link href={newsPath(locale, `/news/${s.section}/`)}>{ns(locale, `tab.${s.section}` as 'tab.headlines')}</Link>
          </p>
          {s.items.map((item) => (
            <LineRow key={item.id} item={item} />
          ))}
        </div>
      ))}
    </RailPanel>
  );
}
