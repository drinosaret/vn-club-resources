'use client';

import Link from '@/components/Link';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { counterpartPath } from '@/lib/news';
import { useTitlePreference } from '@/lib/title-preference';

/**
 * The same page in the other language. Following it also sets the title script to match,
 * as the other Japanese pages do, so a reader who switches to Japanese sees Japanese names.
 */
export function LocaleSwitch({ locale, path }: { locale: Locale; path: string }) {
  const { setPreference } = useTitlePreference();
  return (
    <Link
      href={counterpartPath(locale, path)}
      className="nw-locale"
      lang={locale === 'en' ? 'ja' : 'en'}
      onClick={() => setPreference(locale === 'en' ? 'japanese' : 'romaji')}
    >
      {ns(locale, 'locale.switch')}
    </Link>
  );
}
