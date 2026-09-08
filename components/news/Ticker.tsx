'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import Link from '@/components/Link';
import type { Lang, NewsItem } from '@/lib/news';
import { stringOrNull, tickerUrl } from '@/lib/news';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { lineHref, linePlate, lineTitle } from './LineRow';
import { POLL_MS } from './useNewItems';

/** How fast the strip moves; a whole track passes in its width over this. */
const PX_PER_SECOND = 40;
const MIN_SECONDS = 20;
/** Fewer than this and the strip stands still: a loop of two reads as a stutter. */
const LOOP_MIN = 3;

const JAPANESE = /[぀-ヿ一-鿿]/;

function Track({ items, locale, duplicate = false }: { items: NewsItem[]; locale: Locale; duplicate?: boolean }) {
  const { preference } = useTitlePreference();
  return (
    // The second copy exists to close the loop visually, so it is kept out of the
    // accessibility tree and out of the tab order.
    <ul className="nw-ticker-track" aria-hidden={duplicate || undefined} inert={duplicate || undefined}>
      {items.map((item) => {
        const target = lineHref(item);
        const extra = item.extraData ?? {};
        // A row the catalogue knows carries both scripts of the name, so it follows the
        // reader's choice; anything else has the one name the source printed.
        const name = item.vnId
          ? getDisplayTitle(
              {
                title: item.title,
                title_jp: stringOrNull(extra.alttitle) ?? undefined,
                title_romaji: stringOrNull(extra.title_romaji) ?? undefined,
              },
              preference,
            )
          : item.title;
        const title = lineTitle(item, name);
        const text = (
          <>
            <span className="nw-ticker-src">{linePlate(item, locale)}</span>
            <span lang={JAPANESE.test(title) ? 'ja' : undefined}>{title}</span>
          </>
        );
        return (
          <li key={item.id} className="nw-ticker-item">
            {target ? (
              target.internal ? (
                <Link href={target.href} tabIndex={duplicate ? -1 : undefined}>
                  {text}
                </Link>
              ) : (
                <a href={target.href} target="_blank" rel="noopener noreferrer" tabIndex={duplicate ? -1 : undefined}>
                  {text}
                </a>
              )
            ) : (
              <span>{text}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The newest items across the sections, rolling above the tabs.
 *
 * Two copies of the track sit side by side and slide one track's width, so the loop has
 * no seam. The speed follows the track's width so a long day and a quiet one pass at the
 * same pace. Hovering or tabbing into the strip holds it; a reader who asked for less
 * motion gets a still row that scrolls by hand. The list is refreshed on the same
 * interval as the river's poll.
 */
export function Ticker({ initialItems, lang, locale }: { initialItems: NewsItem[]; lang: Lang | null; locale: Locale }) {
  const [items, setItems] = useState(initialItems);
  const [seconds, setSeconds] = useState(60);
  const [still, setStill] = useState(false);
  const [paused, setPaused] = useState(false);
  const tracks = useRef<HTMLDivElement>(null);
  const plateId = useId();
  const loop = items.length >= LOOP_MIN && !still;

  useEffect(() => {
    const el = tracks.current;
    if (!el) return;
    // The measured box holds both copies of the track while the loop runs.
    const width = el.scrollWidth / (loop ? 2 : 1);
    setSeconds(Math.max(MIN_SECONDS, Math.round(width / PX_PER_SECOND)));
  }, [items, loop]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setStill(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (paused || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(tickerUrl(lang));
        if (!res.ok) return;
        const data = (await res.json()) as { items: NewsItem[] };
        if (data.items.length === 0) return;
        // A new list restarts the slide from the left, so the same list is kept as it is.
        setItems((prev) =>
          data.items.map((i) => i.id).join(',') === prev.map((i) => i.id).join(',') ? prev : data.items,
        );
      } catch {
        // The next tick asks again.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [lang, paused]);

  if (items.length === 0) return null;

  return (
    <div
      className={`${loop ? 'nw-ticker' : 'nw-ticker nw-ticker--still'}${paused ? ' nw-ticker--paused' : ''}`}
      role="region"
      aria-labelledby={plateId}
    >
      <span className="nameplate nw-ticker-plate" id={plateId}>
        {ns(locale, 'ticker.label')}
      </span>
      {loop && (
        // A strip that moves on its own needs a stop that does not depend on a pointer.
        <button
          type="button"
          className="nw-step nw-ticker-pause"
          aria-pressed={paused}
          aria-label={ns(locale, 'ticker.pause')}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? '▶' : '⏸'}
        </button>
      )}
      <div className="nw-ticker-window">
        <div className="nw-ticker-tracks" ref={tracks} style={{ '--nw-ticker-s': `${seconds}s` } as CSSProperties}>
          <Track items={items} locale={locale} />
          {loop && <Track items={items} locale={locale} duplicate />}
        </div>
      </div>
    </div>
  );
}
