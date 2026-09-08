'use client';

import Link from '@/components/Link';
import { LANGS, type Lang } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { skipNextScroll } from '@/components/ScrollToTop';

/**
 * Keep the feed to sources in one language. Rows from the catalogue and the stores are in
 * neither and stay under both. The choice travels in the URL so a page can be shared as
 * seen and the server renders the right first page.
 *
 * The control sits inline beside the tabs, so it carries no spacing of its own.
 */
export function LangToggle({
  path,
  lang,
  locale = 'en',
}: {
  path: string;
  lang: Lang | null;
  locale?: Locale;
}) {
  return (
    <div className="nw-lang" role="group" aria-label={ns(locale, 'lang.label')}>
      <span className="nw-lang-label">{ns(locale, 'lang.label')}</span>
      <Link href={path} onClick={skipNextScroll} className={lang ? 'nw-step' : 'nw-step nw-step--on'}>
        {ns(locale, 'lang.all')}
      </Link>
      {LANGS.map((l) => (
        <Link
          key={l.code}
          href={`${path}?lang=${l.code}`}
          onClick={skipNextScroll}
          className={lang === l.code ? 'nw-step nw-step--on' : 'nw-step'}
          lang={l.code}
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
