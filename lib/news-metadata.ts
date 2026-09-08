import type { Metadata } from 'next';
import { generatePageMetadata, localizedAlternates } from './metadata-utils';
import { OUT_NOW_DAYS } from './out-now';
import type { Locale } from './i18n/types';
import { ns } from './i18n/translations/news';
import { formatLongDate, sectionBySlug } from './news';

/** Metadata for a news page that exists in both languages. `slug` is the path without slashes. */
function localized(locale: Locale, slug: string, title: string, description: string): Metadata {
  const path = locale === 'ja' ? `/ja/${slug}/` : `/${slug}/`;
  return {
    ...generatePageMetadata({ title, description, path }),
    alternates: localizedAlternates(slug, locale),
  };
}

export function frontMetadata(locale: Locale): Metadata {
  return localized(locale, 'news', ns(locale, 'page.title'), ns(locale, 'page.description'));
}

export function sectionMetadata(locale: Locale, slug: string): Metadata {
  const section = sectionBySlug(slug);
  if (!section) return { title: 'Not Found' };
  const label = ns(locale, `tab.${slug}` as 'tab.headlines');
  const blurb = ns(locale, `blurb.${slug}` as 'blurb.headlines', { days: OUT_NOW_DAYS });
  return localized(
    locale,
    `news/${slug}`,
    `${label} | ${ns(locale, 'meta.sectionSuffix')}`,
    `${blurb} ${ns(locale, 'meta.sectionTail')}`,
  );
}

export function dayMetadata(
  locale: Locale,
  slug: string,
  date: string,
  label: string,
  { noIndex = false }: { noIndex?: boolean } = {},
): Metadata {
  const day = formatLongDate(date, locale);
  return {
    ...generatePageMetadata({
      title: `${label} - ${day} | ${ns(locale, 'meta.sectionSuffix')}`,
      description: ns(locale, 'meta.day', { day }),
      path: locale === 'ja' ? `/ja/news/${slug}/${date}/` : `/news/${slug}/${date}/`,
      type: 'article',
      noIndex,
    }),
    alternates: localizedAlternates(`news/${slug}/${date}`, locale),
  };
}

export function upcomingMetadata(locale: Locale): Metadata {
  return localized(
    locale,
    'news/upcoming',
    ns(locale, 'meta.upcoming.title'),
    ns(locale, 'meta.upcoming.description'),
  );
}
