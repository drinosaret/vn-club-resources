import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import type { Lang, NewsItem } from '@/lib/news';
import { LocaleSwitch } from './LocaleSwitch';
import { NsfwToggle } from './NsfwToggle';
import { SourceList } from './SourceList';
import { Ticker } from './Ticker';

/**
 * The frame every news page sits in: the masthead, the ticker, the tabs, and a grid of a
 * facts rail, the page's own column and, where a page has one, a people rail. The rails'
 * panels fold under the stream on a narrow screen.
 *
 * A page that carries its own furniture passes no left rail and gets the frame's whole
 * width as one column.
 */
export function NewsFrame({
  locale,
  path,
  lang = null,
  ticker,
  tabs,
  left,
  right = null,
  mastheadIsHeading = false,
  children,
}: {
  locale: Locale;
  /** The front page is the one the masthead names; every other page names itself. */
  mastheadIsHeading?: boolean;
  /** The page's own path in this locale, for the switch to the other one. */
  path: string;
  lang?: Lang | null;
  ticker: NewsItem[];
  /** The tab row, with the page's own controls opposite it. */
  tabs: React.ReactNode;
  left: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[80vh] px-4 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="nw-mast">
          <div>
            {mastheadIsHeading ? (
              <h1 className="nw-mast-title">{ns(locale, 'page.title')}</h1>
            ) : (
              <p className="nw-mast-title">{ns(locale, 'page.title')}</p>
            )}
            <p className="nw-mast-sub">{ns(locale, 'page.subtitle')}</p>
          </div>
          <div className="nw-mast-controls">
            <NsfwToggle locale={locale} />
            <LocaleSwitch locale={locale} path={path} />
          </div>
        </div>
        <Ticker initialItems={ticker} lang={lang} locale={locale} />
        {tabs}
        {left === null ? (
          <div className="nw-grid nw-grid--solo">
            <div className="nw-main">{children}</div>
          </div>
        ) : (
          <div className={right ? 'nw-grid nw-grid--3' : 'nw-grid'}>
            <aside className="nw-rail" aria-label={ns(locale, 'rail.left')}>
              {left}
            </aside>
            <div className="nw-main">{children}</div>
            {right && (
              <aside className="nw-rail" aria-label={ns(locale, 'rail.right')}>
                {right}
              </aside>
            )}
          </div>
        )}
        <SourceList locale={locale} />
      </div>
    </div>
  );
}
