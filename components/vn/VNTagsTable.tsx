'use client';

import { useState, useMemo } from 'react';
import Link from '@/components/Link';
import type { VNTag } from '@/lib/vndb-stats-api';

interface VNTagsTableProps {
  tags?: VNTag[];
  showSpoilers: boolean;
  onShowSpoilersChange: (show: boolean) => void;
  showSexual: boolean;
  onShowSexualChange: (show: boolean) => void;
}

type SortField = 'name' | 'score' | 'weight' | 'importance';
type SortDir = 'asc' | 'desc';

export function VNTagsTable({ tags, showSpoilers, onShowSpoilersChange, showSexual, onShowSexualChange }: VNTagsTableProps) {
  const [sortField, setSortField] = useState<SortField>('weight');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const processedTags = useMemo(() => {
    if (!tags) return [];

    // Approximate total VNs in VNDB for IDF (inverse document frequency) calculation.
    // Used to weight rare tags higher; rough constant is fine since IDF is only
    // used for relative ranking within a single VN's tags.
    const TOTAL_VNS = 50000;

    // Calculate importance and weight for ALL tags first (stable normalization)
    const allWithWeight = tags.map(t => {
      const vnCount = t.vn_count || 1;
      const importance = Math.log(TOTAL_VNS / Math.max(vnCount, 1));
      const weight = t.score * importance;
      return { ...t, importance, weight };
    });

    // Normalize weight to 0-100 scale using ALL tags (top item = 100)
    // This keeps weights stable when toggling spoilers/sexual
    const maxWeight = Math.max(...allWithWeight.map(t => t.weight), 1);
    const normalized = allWithWeight.map(t => ({
      ...t,
      weight: (t.weight / maxWeight) * 100,
    }));

    // Filter after normalization
    const filtered = normalized.filter(t => (showSpoilers || t.spoiler === 0) && (showSexual || t.category !== 'ero'));

    // Sort
    return filtered.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'score') cmp = a.score - b.score;
      else if (sortField === 'importance') cmp = a.importance - b.importance;
      else cmp = a.weight - b.weight;
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [tags, showSpoilers, showSexual, sortField, sortDir]);

  // Counts respect the other toggle's state so they reflect what would actually appear
  const spoilerCount = tags?.filter(t => t.spoiler > 0 && (showSexual || t.category !== 'ero')).length || 0;
  const sexualCount = tags?.filter(t => t.category === 'ero' && (showSpoilers || t.spoiler === 0)).length || 0;

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // Direction is carried by the glyph, so a sorted column reads the same without colour.
  const SortMark = ({ field }: { field: SortField }) => (
    <span aria-hidden className={sortField === field ? '' : 'opacity-30'}>
      {sortField === field ? (sortDir === 'asc' ? '▲' : '▼') : '▽'}
    </span>
  );

  if (!tags || tags.length === 0) {
    return (
      <section className="vn-sec p-4 sm:p-6">
        <div className="vn-sec-head">
          <h2 className="vn-sec-title">Tags</h2>
        </div>
        <p className="text-[color:var(--nezu)] text-center py-4">
          No tags available.
        </p>
      </section>
    );
  }

  return (
    <section className="vn-sec overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-[color:var(--rule)]">
        <div className="flex items-baseline gap-2">
          <h2 className="vn-sec-title">Tags</h2>
          <span className="vn-num text-sm text-[color:var(--text-faint)]">{processedTags.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {sexualCount > 0 && (
            <button
              onClick={() => onShowSexualChange(!showSexual)}
              aria-pressed={showSexual}
              className={`tab${showSexual ? ' tab--on' : ''}`}
            >
              <span><span className="hidden sm:inline">{showSexual ? 'Hide' : 'Show'} </span>sexual</span>
              <span className="tab-count">{sexualCount}</span>
            </button>
          )}
          {spoilerCount > 0 && (
            <button
              onClick={() => onShowSpoilersChange(!showSpoilers)}
              aria-pressed={showSpoilers}
              className={`tab${showSpoilers ? ' tab--on' : ''}`}
            >
              <span><span className="hidden sm:inline">{showSpoilers ? 'Hide' : 'Show'} </span>spoilers</span>
              <span className="tab-count">{spoilerCount}</span>
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[color:var(--surface-inset)]">
            <tr>
              <th className="px-3 sm:px-4 py-3 text-left" aria-sort={sortField === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <button onClick={() => handleSort('name')} className="flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--nezu)]">
                  Name <SortMark field="name" />
                </button>
              </th>
              <th className="px-2 sm:px-4 py-3 text-right whitespace-nowrap" aria-sort={sortField === 'score' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <button onClick={() => handleSort('score')} className="flex items-center gap-1 ml-auto font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--nezu)]">
                  Score <SortMark field="score" />
                </button>
              </th>
              <th className="hidden sm:table-cell px-2 sm:px-4 py-3 text-right whitespace-nowrap" aria-sort={sortField === 'importance' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <button onClick={() => handleSort('importance')} className="flex items-center gap-1 ml-auto font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--nezu)]">
                  Importance <SortMark field="importance" />
                </button>
              </th>
              <th className="px-2 sm:px-4 py-3 text-right whitespace-nowrap" aria-sort={sortField === 'weight' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <button onClick={() => handleSort('weight')} className="flex items-center gap-1 ml-auto font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--nezu)]">
                  Weight <SortMark field="weight" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--rule)]">
            {processedTags.map((tag) => (
              <tr key={tag.id} className="hover:bg-[color:var(--surface-inset)]">
                <td className="px-3 sm:px-4 py-2">
                  <Link
                    href={`/stats/tag/${tag.id}`}
                    className="text-sm text-[color:var(--ink)] hover:text-[color:var(--ai)] transition-colors"
                    title={tag.name}
                  >
                    {tag.name}
                    {tag.spoiler > 0 && <span className="ml-1 font-mono text-[color:var(--beni-text)]">!</span>}
                    {tag.category === 'ero' && <span className="ml-1 font-mono text-[color:var(--beni-text)]">&#9829;</span>}
                  </Link>
                </td>
                <td className="vn-num px-2 sm:px-4 py-2 text-right text-sm text-[color:var(--nezu)] whitespace-nowrap">
                  {tag.score.toFixed(2)}
                </td>
                <td className="vn-num hidden sm:table-cell px-2 sm:px-4 py-2 text-right text-sm text-[color:var(--nezu)] whitespace-nowrap">
                  {tag.importance.toFixed(2)}
                </td>
                <td className="vn-num px-2 sm:px-4 py-2 text-right text-sm text-[color:var(--ink)] whitespace-nowrap">
                  {tag.weight.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
