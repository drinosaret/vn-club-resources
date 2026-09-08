'use client';

import { useState } from 'react';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { shortDay, type DlsiteRankEntry } from '@/lib/news';
import { RankRow } from '../DlsiteRankings';
import { RailPanel } from '../rail/RailPanel';

const TOP = 10;
const DEEP = 20;

interface Board {
  key: string;
  label: string;
  rows: DlsiteRankEntry[];
  asOf: string | null;
}

/**
 * Both stores' rankings in one board: a tab per list, a short run of places at a time, and the stamp
 * of the list being read. A store's list is left out when the last read of it came back
 * empty rather than drawn as an empty tab.
 */
export function RankingsBoard({
  locale,
  dlsite,
  getchu,
}: {
  locale: Locale;
  dlsite?: { asOf?: string | null; pro?: DlsiteRankEntry[]; maniax?: DlsiteRankEntry[] };
  getchu?: { asOf?: string | null; reserve?: DlsiteRankEntry[]; sales?: DlsiteRankEntry[] };
}) {
  const [active, setActive] = useState(0);
  const [deep, setDeep] = useState(false);

  const boards: Board[] = [
    { key: 'dlsite-pro', label: ns(locale, 'ranks.tabs.dlsitePro'), rows: dlsite?.pro ?? [], asOf: dlsite?.asOf ?? null },
    {
      key: 'dlsite-doujin',
      label: ns(locale, 'ranks.tabs.dlsiteDoujin'),
      rows: dlsite?.maniax ?? [],
      asOf: dlsite?.asOf ?? null,
    },
    {
      key: 'getchu-reserve',
      label: ns(locale, 'ranks.tabs.getchuReserve'),
      rows: getchu?.reserve ?? [],
      asOf: getchu?.asOf ?? null,
    },
    {
      key: 'getchu-sales',
      label: ns(locale, 'ranks.tabs.getchuSales'),
      rows: getchu?.sales ?? [],
      asOf: getchu?.asOf ?? null,
    },
  ].filter((board) => board.rows.length > 0);

  if (boards.length === 0) return null;
  const current = boards[Math.min(active, boards.length - 1)];
  const stamp = current.asOf ? shortDay(current.asOf.slice(0, 10), locale) : null;

  return (
    <RailPanel id="rel-ranks" plate={ns(locale, 'rel.rankings')}>
      {boards.length > 1 && (
        <div className="nw-rank-tabs">
          {boards.map((board, i) => (
            <button
              key={board.key}
              type="button"
              aria-pressed={i === active}
              className={i === active ? 'nw-step nw-step--on' : 'nw-step'}
              onClick={() => setActive(i)}
            >
              {board.label}
            </button>
          ))}
        </div>
      )}
      <ol className="nw-rank-list">
        {current.rows.slice(0, deep ? DEEP : TOP).map((entry) => (
          <RankRow key={entry.productId} entry={entry} />
        ))}
      </ol>
      <div className="nw-shelf-foot">
        {current.rows.length > TOP && (
          <button
            type="button"
            aria-pressed={deep}
            className={deep ? 'nw-step nw-step--on' : 'nw-step'}
            onClick={() => setDeep((open) => !open)}
          >
            {ns(locale, 'rel.top20')}
          </button>
        )}
        {stamp && <span className="nw-shelf-stamp">{ns(locale, 'ranks.asOf', { day: stamp })}</span>}
      </div>
    </RailPanel>
  );
}
