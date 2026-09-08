'use client';

import { useState } from 'react';
import type { DlsiteRankEntry } from '@/lib/news';
import { DLSITE_PATH, newsPath } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { RankRow } from '../DlsiteRankings';
import { RailPanel } from './RailPanel';

const TOP = 5;

/** The two stores' rankings as tabs in one panel: DLsite's weekly adventure games and Getchu's pre-orders. */
export function RankingsPanel({ locale, dlsite, getchu }: { locale: Locale; dlsite: DlsiteRankEntry[]; getchu: DlsiteRankEntry[] }) {
  const tabs = [
    { key: 'dlsite', label: ns(locale, 'rail.rankings.dlsite'), rows: dlsite.slice(0, TOP) },
    { key: 'getchu', label: ns(locale, 'rail.rankings.getchu'), rows: getchu.slice(0, TOP) },
  ].filter((t) => t.rows.length > 0);
  const [active, setActive] = useState(0);
  if (tabs.length === 0) return null;
  const current = tabs[Math.min(active, tabs.length - 1)];
  return (
    <RailPanel
      plate={ns(locale, 'rail.rankings')}
      href={newsPath(locale, DLSITE_PATH)}
      hrefLabel={ns(locale, 'rail.rankings.more')}
    >
      {tabs.length > 1 && (
        <div className="nw-rank-tabs">
          {tabs.map((t, i) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={i === active}
              className={i === active ? 'nw-step nw-step--on' : 'nw-step'}
              onClick={() => setActive(i)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <ol className="nw-rank-list">
        {current.rows.map((e) => (
          <RankRow key={e.productId} entry={e} />
        ))}
      </ol>
    </RailPanel>
  );
}
