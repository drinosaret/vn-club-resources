'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, ArrowUpDown, User } from 'lucide-react';
import { vndbStatsApi, type VNCharacter, type AggregatedTrait } from '@/lib/vndb-stats-api';

interface VNTraitsProps {
  characters: VNCharacter[];
  isLoading?: boolean;
  globalCounts?: { counts: Record<string, number>; total_characters: number } | null;
  showSpoilers: boolean;
  onShowSpoilersChange: (show: boolean) => void;
}

type SortField = 'name' | 'characters' | 'importance' | 'weight';
type SortDir = 'asc' | 'desc';

export function VNTraits({ characters, isLoading, globalCounts: globalCountsProp, showSpoilers, onShowSpoilersChange }: VNTraitsProps) {
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

  const { traits, totalCharacters, spoilerCount } = useMemo(() => {
    if (!characters || characters.length === 0) {
      return { traits: [], totalCharacters: 0, spoilerCount: 0 };
    }

    const traitMap = new Map<string, { name: string; group_name?: string; spoiler: number; count: number }>();
    let spoilers = 0;

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
        if (trait.spoiler > 0) spoilers++;
      }
    }

    const total = characters.length;
    // Use global total characters for IDF, fallback to approximation
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

    return { traits: aggregated, totalCharacters: total, spoilerCount: spoilers };
  }, [characters, globalCounts]);

  const filteredTraits = useMemo(() => {
    let filtered = showSpoilers ? traits : traits.filter(t => t.spoiler === 0);

    // Normalize weight to 0-100 scale (top visible item = 100)
    const maxWeight = Math.max(...filtered.map(t => t.weight), 1);
    const normalized = filtered.map(t => ({
      ...t,
      weight: (t.weight / maxWeight) * 100,
    }));

    return normalized.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'characters') cmp = a.character_count - b.character_count;
      else if (sortField === 'importance') cmp = a.importance - b.importance;
      else cmp = a.weight - b.weight;
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [traits, showSpoilers, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const isReady = !isLoading;
  const isEmpty = isReady && traits.length === 0;

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden ${isReady ? '' : 'opacity-0'}`}
    >
      {isEmpty ? (
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <User className="w-5 h-5 text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Traits</h2>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-center py-4">
            No character traits available.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-primary-500" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Traits</h2>
              <span className="text-sm text-gray-400">({filteredTraits.length})</span>
            </div>
            {spoilerCount > 0 && (
              <button
                onClick={() => onShowSpoilersChange(!showSpoilers)}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm rounded-lg transition-colors flex-shrink-0 ${
                  showSpoilers
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                {showSpoilers ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                <span className="hidden sm:inline">{showSpoilers ? 'Hide' : 'Show'} </span>spoilers
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-3 sm:px-4 py-3 text-left">
                    <button onClick={() => handleSort('name')} className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Name <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-2 sm:px-4 py-3 text-right">
                    <button onClick={() => handleSort('characters')} className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase ml-auto">
                      <span className="sm:hidden">Chars</span><span className="hidden sm:inline">Characters</span> <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-2 sm:px-4 py-3 text-right">
                    <button onClick={() => handleSort('importance')} className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase ml-auto">
                      <span className="sm:hidden">Imp.</span><span className="hidden sm:inline">Importance</span> <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-2 sm:px-4 py-3 text-right">
                    <button onClick={() => handleSort('weight')} className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase ml-auto">
                      Weight <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredTraits.map((trait) => (
                  <tr key={trait.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 ${trait.spoiler > 0 ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                    <td className="px-3 sm:px-4 py-2">
                      <div>
                        <Link
                          href={`/stats/trait/${trait.id}`}
                          className="text-sm text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                        >
                          {trait.name}
                          {trait.spoiler > 0 && <span className="ml-1 text-red-500">!</span>}
                        </Link>
                        {trait.group_name && (
                          <span className="ml-2 text-xs text-gray-400 hidden sm:inline">{trait.group_name}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 sm:px-4 py-2 text-right text-sm text-gray-600 dark:text-gray-400">
                      {trait.character_count}
                    </td>
                    <td className="px-2 sm:px-4 py-2 text-right text-sm text-gray-600 dark:text-gray-400">
                      {trait.importance.toFixed(2)}
                    </td>
                    <td className="px-2 sm:px-4 py-2 text-right text-sm font-medium text-gray-900 dark:text-white">
                      {trait.weight.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
