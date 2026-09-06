'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from '@/components/Link';
import { vndbStatsApi, type VNCharacter, type AggregatedTrait } from '@/lib/vndb-stats-api';

interface VNTraitsProps {
  characters: VNCharacter[];
  isLoading?: boolean;
  globalCounts?: { counts: Record<string, number>; total_characters: number } | null;
  showSpoilers: boolean;
  onShowSpoilersChange: (show: boolean) => void;
  showSexual: boolean;
  onShowSexualChange: (show: boolean) => void;
}

type SortField = 'name' | 'characters' | 'importance' | 'weight';
type SortDir = 'asc' | 'desc';

export function VNTraits({ characters, isLoading, globalCounts: globalCountsProp, showSpoilers, onShowSpoilersChange, showSexual, onShowSexualChange }: VNTraitsProps) {
  const [sortField, setSortField] = useState<SortField>('weight');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [localGlobalCounts, setLocalGlobalCounts] = useState<VNTraitsProps['globalCounts']>(null);

  // Use parent-provided counts if available, otherwise fall back to local fetch
  const globalCounts = globalCountsProp ?? localGlobalCounts;

  // Collect all trait IDs from characters
  const traitIds = useMemo(() => {
    const ids = new Set<string>();
    for (const char of characters || []) {
      for (const trait of char.traits) {
        ids.add(trait.id);
      }
    }
    return Array.from(ids);
  }, [characters]);

  // Only fetch locally if parent didn't provide globalCounts
  useEffect(() => {
    if (globalCountsProp === undefined && traitIds.length > 0 && !localGlobalCounts) {
      vndbStatsApi.getTraitCounts(traitIds)
        .then(setLocalGlobalCounts)
        .catch(() => {});
    }
  }, [globalCountsProp, traitIds, localGlobalCounts]);

  const { traits, totalCharacters } = useMemo(() => {
    if (!characters || characters.length === 0) {
      return { traits: [], totalCharacters: 0 };
    }

    const traitMap = new Map<string, { name: string; group_name?: string; spoiler: number; count: number }>();

    for (const char of characters) {
      for (const trait of char.traits) {
        const key = trait.id;
        const existing = traitMap.get(key);
        if (existing) {
          existing.count++;
          existing.spoiler = Math.max(existing.spoiler, trait.spoiler);
        } else {
          traitMap.set(key, {
            name: trait.name,
            group_name: trait.group_name,
            spoiler: trait.spoiler,
            count: 1,
          });
        }
      }
    }

    const total = characters.length;
    // Use global total characters for IDF (inverse document frequency).
    // Fallback ~500K is the approximate total characters in VNDB; rough constant
    // is fine since IDF is only used for relative ranking within this VN's traits.
    const globalTotal = globalCounts?.total_characters || 500000;
    let aggregated: AggregatedTrait[] = [];

    for (const [id, data] of traitMap.entries()) {
      // IDF: log(total_characters / char_count) - rarer traits globally are more important
      const globalCharCount = globalCounts?.counts[id] || 1;
      const importance = Math.log(globalTotal / Math.max(globalCharCount, 1));
      // Weight: importance * local character count (rare traits on many characters = high weight)
      const weight = importance * data.count;
      aggregated.push({
        id,
        name: data.name,
        group_name: data.group_name,
        spoiler: data.spoiler,
        character_count: data.count,
        importance,
        weight,
      });
    }

    return { traits: aggregated, totalCharacters: total };
  }, [characters, globalCounts]);

  // Counts respect the other toggle's state so they reflect what would actually appear
  const spoilerCount = useMemo(() =>
    traits.filter(t => t.spoiler > 0 && (showSexual || !t.group_name?.includes('(Sexual)'))).length,
    [traits, showSexual]
  );
  const sexualCount = useMemo(() =>
    traits.filter(t => t.group_name?.includes('(Sexual)') && (showSpoilers || t.spoiler === 0)).length,
    [traits, showSpoilers]
  );

  const filteredTraits = useMemo(() => {
    // Normalize weight to 0-100 scale using ALL traits (stable when toggling filters)
    const maxWeight = Math.max(...traits.map(t => t.weight), 1);
    const normalized = traits.map(t => ({
      ...t,
      weight: (t.weight / maxWeight) * 100,
    }));

    // Filter after normalization
    const filtered = normalized.filter(t =>
      (showSpoilers || t.spoiler === 0) && (showSexual || !t.group_name?.includes('(Sexual)'))
    );

    return filtered.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'characters') cmp = a.character_count - b.character_count;
      else if (sortField === 'importance') cmp = a.importance - b.importance;
      else cmp = a.weight - b.weight;
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [traits, showSpoilers, showSexual, sortField, sortDir]);

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

  const isReady = !isLoading;
  const isEmpty = isReady && traits.length === 0;

  return (
    <section className={`vn-sec overflow-hidden ${isReady ? '' : 'opacity-0'}`}>
      {isEmpty ? (
        <div className="p-4 sm:p-6">
          <div className="vn-sec-head">
            <h2 className="vn-sec-title">Traits</h2>
          </div>
          <p className="text-[color:var(--nezu)] text-center py-4">
            No character traits available.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-[color:var(--rule)]">
            <div className="flex items-baseline gap-2">
              <h2 className="vn-sec-title">Traits</h2>
              <span className="vn-num text-sm text-[color:var(--text-faint)]">{filteredTraits.length}</span>
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
                  <th className="px-2 sm:px-4 py-3 text-right whitespace-nowrap" aria-sort={sortField === 'characters' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button onClick={() => handleSort('characters')} className="flex items-center gap-1 ml-auto font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--nezu)]">
                      <span className="sm:hidden">Chars</span><span className="hidden sm:inline">Characters</span> <SortMark field="characters" />
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
                {filteredTraits.map((trait) => (
                  <tr key={trait.id} className="hover:bg-[color:var(--surface-inset)]">
                    <td className="px-3 sm:px-4 py-2">
                      <div>
                        <Link
                          href={`/stats/trait/${trait.id}`}
                          className="text-sm text-[color:var(--ink)] hover:text-[color:var(--ai)] transition-colors"
                          title={trait.name}
                        >
                          {trait.name}
                          {trait.spoiler > 0 && <span className="ml-1 font-mono text-[color:var(--beni-text)]">!</span>}
                          {trait.group_name?.includes('(Sexual)') && <span className="ml-1 font-mono text-[color:var(--beni-text)]">&#9829;</span>}
                        </Link>
                        {trait.group_name && (
                          <span className="ml-2 text-xs text-[color:var(--text-faint)] hidden sm:inline">{trait.group_name}</span>
                        )}
                      </div>
                    </td>
                    <td className="vn-num px-2 sm:px-4 py-2 text-right text-sm text-[color:var(--nezu)] whitespace-nowrap">
                      {trait.character_count}
                    </td>
                    <td className="vn-num hidden sm:table-cell px-2 sm:px-4 py-2 text-right text-sm text-[color:var(--nezu)] whitespace-nowrap">
                      {trait.importance.toFixed(2)}
                    </td>
                    <td className="vn-num px-2 sm:px-4 py-2 text-right text-sm text-[color:var(--ink)] whitespace-nowrap">
                      {trait.weight.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
