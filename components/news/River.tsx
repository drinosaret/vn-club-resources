'use client';

import { useState } from 'react';
import type { Lang, NewsItem } from '@/lib/news';
import { dayLabel, feedUrl, isPostSource, isReleaseSource, isReviewSource } from '@/lib/news';
import { useLocale } from '@/lib/i18n/locale-context';
import { ns } from '@/lib/i18n/translations/news';
import { HeadlineRow, bodyAfterTitle } from './HeadlineRow';
import { LeadStory } from './LeadStory';
import { LineRow } from './LineRow';
import { ReleaseRow } from './ReleaseRow';
import { ReviewRow } from './ReviewRow';
import { TrailerRow } from './TrailerRow';
import { DayDivider } from './DayDivider';
import { BurstRow } from './BurstRow';
import { NewItemsPill } from './NewItemsPill';
import { useNewItems } from './useNewItems';
import { RiverModule, type ModuleKind } from './modules/RiverModule';

const PAGE = 30;
const LEAD_WINDOW_MS = 24 * 3600 * 1000;

/** A run of at least this many consecutive posts from one account folds into one row. */
const BURST_MIN = 3;

const MODULE_ORDER: readonly ModuleKind[] = ['trailers', 'covers', 'reviews'];

export interface RiverModules {
  trailers: NewsItem[];
  covers: NewsItem[];
  reviews: NewsItem[];
}

function Featured({ item }: { item: NewsItem }) {
  if (isReleaseSource(item.source)) {
    return (
      <ul className="nw-release-list">
        <ReleaseRow item={item} badge="day" />
      </ul>
    );
  }
  if (item.source === 'youtube') return <TrailerRow item={item} />;
  if (isReviewSource(item.source)) return <ReviewRow item={item} />;
  return <HeadlineRow item={item} />;
}

function illustrated(item: NewsItem): boolean {
  return Boolean(item.imageUrl) && !item.imageIsNsfw;
}

/**
 * Whether an item has something to say beyond its own name. A post's first line stands as
 * its title, so only what follows counts as a body; everything else carries a summary of
 * its own.
 */
function hasBody(item: NewsItem): boolean {
  if (isPostSource(item.source)) return bodyAfterTitle(item) !== null;
  return Boolean(item.summary?.trim());
}

/** An item with neither a picture nor a body has nothing a full row would show. */
function worthARow(item: NewsItem): boolean {
  return illustrated(item) || hasBody(item);
}

type Entry = { kind: 'item'; item: NewsItem } | { kind: 'burst'; items: NewsItem[] };

/**
 * Consecutive posts from the same account on the same day become one entry. Anything else,
 * and any run too short to be a burst, stays as it is.
 */
function foldBursts(items: NewsItem[]): Entry[] {
  const entries: Entry[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (!isPostSource(item.source)) {
      entries.push({ kind: 'item', item });
      i += 1;
      continue;
    }
    let j = i + 1;
    while (
      j < items.length &&
      items[j].source === item.source &&
      items[j].sourceLabel === item.sourceLabel &&
      items[j].publishedAt.slice(0, 10) === item.publishedAt.slice(0, 10)
    ) {
      j += 1;
    }
    if (j - i >= BURST_MIN) {
      entries.push({ kind: 'burst', items: items.slice(i, j) });
    } else {
      for (let k = i; k < j; k += 1) entries.push({ kind: 'item', item: items[k] });
    }
    i = j;
  }
  return entries;
}

/**
 * Hands out modules in turn, skipping a kind with nothing left and never the same kind
 * twice running. A kind is drained as it is handed out, so a long page does not repeat a
 * strip. Items already on the page are left out of every module.
 */
function makeModulePicker(modules: RiverModules | null, shown: Set<string>) {
  let next = 0;
  let last: ModuleKind | null = null;
  const pool: Record<ModuleKind, NewsItem[]> = {
    trailers: (modules?.trailers ?? []).filter((i) => !shown.has(i.id)),
    covers: (modules?.covers ?? []).filter((i) => !shown.has(i.id)),
    reviews: (modules?.reviews ?? []).filter((i) => !shown.has(i.id)),
  };
  return (): { kind: ModuleKind; items: NewsItem[] } | null => {
    for (let step = 0; step < MODULE_ORDER.length; step += 1) {
      const kind = MODULE_ORDER[(next + step) % MODULE_ORDER.length];
      if (kind === last || pool[kind].length === 0) continue;
      next = (next + step + 1) % MODULE_ORDER.length;
      last = kind;
      const items = pool[kind];
      pool[kind] = [];
      return { kind, items };
    }
    return null;
  };
}

/**
 * The stream of items, newest first, ruled off by day, growing downward on request and
 * offering what arrives at the top.
 *
 * The first page arrives with the markup; later pages are asked for from the browser with
 * the cursor the last page handed back, so a reader who keeps going never sees a row twice.
 * An item with a picture or a body keeps a full row; one with neither takes a single line,
 * since the row would hold nothing the line does not. Modules sit after the second and
 * later day rules, only among the rows the page was built with.
 */
export function River({
  section,
  initialItems,
  initialCursor,
  newestCursor = null,
  today,
  lead = false,
  dividers = true,
  lang = null,
  modules = null,
  poll = true,
}: {
  section: string;
  initialItems: NewsItem[];
  initialCursor: string | null;
  /** The newest row's cursor, which the poll for new rows starts from. */
  newestCursor?: string | null;
  lang?: Lang | null;
  /** The UTC day the markup was built for; day labels are read against it. */
  today: string;
  /** Promote the newest illustrated item of the last day to a lead story. */
  lead?: boolean;
  dividers?: boolean;
  modules?: RiverModules | null;
  /** Whether to ask for new rows while the page is open. Off for an archive day. */
  poll?: boolean;
}) {
  const locale = useLocale();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [newest, setNewest] = useState(newestCursor);
  const [busy, setBusy] = useState(false);
  // The rows the page was built with; modules are placed among these only, since the
  // lists behind them do not grow with the page.
  const [initialIds] = useState(() => new Set(initialItems.map((i) => i.id)));
  const fresh = useNewItems({ section, lang, cursor: newest, enabled: poll });

  async function loadOlder() {
    if (!cursor || busy) return;
    setBusy(true);
    try {
      const res = await fetch(feedUrl(section, { before: cursor, limit: PAGE, lang }));
      if (!res.ok) return;
      const page = (await res.json()) as { items: NewsItem[]; nextCursor: string | null };
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // The button stays available for another try.
    } finally {
      setBusy(false);
    }
  }

  function takeFresh() {
    setItems((prev) => {
      const seen = new Set(prev.map((i) => i.id));
      return [...fresh.items.filter((i) => !seen.has(i.id)), ...prev];
    });
    if (fresh.newestCursor) setNewest(fresh.newestCursor);
    fresh.clear();
  }

  const todayStart = Date.parse(`${today}T00:00:00Z`);
  const leadIndex = lead
    ? items.findIndex(
        (i) =>
          i.imageUrl &&
          !i.imageIsNsfw &&
          !isReleaseSource(i.source) &&
          i.source !== 'youtube' &&
          Date.parse(i.publishedAt) > todayStart - LEAD_WINDOW_MS,
      )
    : -1;
  const rest = leadIndex >= 0 ? items.filter((_, i) => i !== leadIndex) : items;
  const entries = foldBursts(rest);
  const pickModule = makeModulePicker(modules, new Set(items.map((i) => i.id)));

  const nodes: React.ReactNode[] = [];
  let lastDay = '';
  let dayIndex = -1;
  for (const entry of entries) {
    const head = entry.kind === 'item' ? entry.item : entry.items[0];
    const day = head.publishedAt.slice(0, 10);
    if (day !== lastDay) {
      lastDay = day;
      dayIndex += 1;
      if (dividers) nodes.push(<DayDivider key={`day:${day}`} label={dayLabel(day, today, locale)} />);
      if (dayIndex >= 1 && initialIds.has(head.id)) {
        const picked = pickModule();
        if (picked) nodes.push(<RiverModule key={`module:${day}`} kind={picked.kind} items={picked.items} />);
      }
    }
    if (entry.kind === 'burst') {
      nodes.push(<BurstRow key={head.id} items={entry.items} />);
      continue;
    }
    nodes.push(
      worthARow(entry.item) ? <Featured key={head.id} item={entry.item} /> : <LineRow key={head.id} item={entry.item} />,
    );
  }

  return (
    <div className="nw-river">
      <NewItemsPill count={fresh.items.length} onTake={takeFresh} />
      {leadIndex >= 0 && <LeadStory item={items[leadIndex]} />}
      {nodes}
      {items.length === 0 && <p className="nw-empty">{ns(locale, 'river.empty')}</p>}
      {cursor && (
        <button type="button" onClick={loadOlder} disabled={busy} className="nw-step nw-more">
          {busy ? ns(locale, 'river.loading') : ns(locale, 'river.loadOlder')}
        </button>
      )}
    </div>
  );
}
