import { notFound, permanentRedirect } from 'next/navigation';
import Link from '@/components/Link';
import { SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import {
  ALL_SLUG,
  LEGACY_SLUGS,
  SECTIONS,
  fetchDay,
  fetchRail,
  fetchTicker,
  formatLongDate,
  isValidDate,
  newsPath,
  sectionBySlug,
  shiftDay,
  utcToday,
  type NewsItem,
} from '@/lib/news';
import { NewsFrame } from '../NewsFrame';
import { NewsTabs } from '../NewsTabs';
import { River } from '../River';
import { ElsewherePanel } from '../rail/ElsewherePanel';
import { ArchiveCalendar } from '../ArchiveCalendar';

export function dayRedirect(locale: Locale, slug: string, date: string): string | null {
  const target = LEGACY_SLUGS[slug];
  if (!target) return null;
  return newsPath(locale, target === 'front' ? `/news/${ALL_SLUG}/${date}/` : `/news/${target}/${date}/`);
}

export function dayLabelFor(locale: Locale, slug: string): string | null {
  if (slug === ALL_SLUG) return ns(locale, 'archive.all');
  return sectionBySlug(slug) ? ns(locale, `tab.${slug}` as 'tab.headlines') : null;
}

/** Everything filed on one day, in either language. */
export async function DayPage({ locale, slug, date }: { locale: Locale; slug: string; date: string }) {
  const target = dayRedirect(locale, slug, date);
  if (target) permanentRedirect(target);
  const label = dayLabelFor(locale, slug);
  if (!label || !isValidDate(date)) notFound();

  const today = utcToday();
  const isAll = slug === ALL_SLUG;
  const [data, rail, ticker] = await Promise.all([
    fetchDay(date, isAll ? undefined : slug),
    fetchRail(isAll ? 'day' : slug),
    fetchTicker(null, 3600),
  ]);
  const day = formatLongDate(date, locale);
  const canGoForward = date < today;
  const path = newsPath(locale, `/news/${slug}/${date}/`);
  const at = (p: string) => newsPath(locale, p);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${label} - ${day}`,
      description: ns(locale, 'meta.day', { day }),
      url: `${SITE_URL}${path}`,
      datePublished: date,
      inLanguage: locale,
      isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
      numberOfItems: data.items.length,
    },
    generateBreadcrumbJsonLd([
      { name: ns(locale, 'crumb.home'), path: locale === 'ja' ? '/ja/' : '/' },
      { name: ns(locale, 'page.title'), path: at('/news/') },
      ...(isAll ? [] : [{ name: label, path: at(`/news/${slug}/`) }]),
      { name: day, path },
    ]),
  ];

  // The all-sections day is grouped so a reader can skip what they do not follow.
  const groups: { slug: string; label: string; items: NewsItem[] }[] = isAll
    ? SECTIONS.map((s) => ({
        slug: s.slug,
        label: ns(locale, `tab.${s.slug}` as 'tab.headlines'),
        items: data.items.filter((i) => s.sources.includes(i.source)),
      })).filter((g) => g.items.length > 0)
    : data.items.length > 0
      ? [{ slug, label, items: data.items }]
      : [];

  return (
    <NewsFrame
      locale={locale}
      path={path}
      ticker={ticker}
      tabs={
        <NewsTabs
          active={isAll ? 'front' : slug}
          locale={locale}
          controls={<ArchiveCalendar section={isAll ? 'front' : slug} currentDate={date} compact />}
        />
      }
      left={<ElsewherePanel locale={locale} sections={rail.elsewhere} />}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <div className="nw-day-head">
        <h1 className="nw-section-title">{day}</h1>
        <div className="flex items-center gap-1.5">
          <Link href={at(`/news/${slug}/${shiftDay(date, -1)}/`)} className="nw-step" aria-label={ns(locale, 'archive.prev')}>
            ←
          </Link>
          {canGoForward ? (
            <Link href={at(`/news/${slug}/${shiftDay(date, 1)}/`)} className="nw-step" aria-label={ns(locale, 'archive.next')}>
              →
            </Link>
          ) : (
            <span className="nw-step" aria-disabled="true">
              →
            </span>
          )}
          <Link href={isAll ? at('/news/') : at(`/news/${slug}/`)} className="nw-step">
            {ns(locale, 'archive.latest')}
          </Link>
        </div>
      </div>

      {data.error && <p className="nw-notice">{ns(locale, 'archive.error')}</p>}

      <>
        {groups.length === 0 && !data.error && (
          <p className="nw-empty">{ns(locale, 'archive.empty', { label: label.toLowerCase(), day })}</p>
        )}
        {groups.map((g) => (
          <section key={g.slug} className="nw-day-group">
            {isAll && (
              <div className="nw-group">
                <h3 className="nw-group-title">{g.label}</h3>
                <span className="nameplate nameplate--plain tabular-nums">
                  {g.items.length === 1 ? ns(locale, 'archive.item') : ns(locale, 'archive.items', { n: g.items.length })}
                </span>
              </div>
            )}
            <River
              section={g.slug}
              initialItems={g.items}
              initialCursor={null}
              today={today}
              dividers={false}
              poll={false}
            />
          </section>
        ))}
      </>
    </NewsFrame>
  );
}

/**
 * Whether a day has anything filed. A day the backend could not answer for counts as
 * filled, so a passing outage does not mark the page as empty.
 */
export async function dayHasItems(slug: string, date: string): Promise<boolean> {
  const data = await fetchDay(date, slug === ALL_SLUG ? undefined : slug);
  return Boolean(data.error) || data.items.length > 0;
}
