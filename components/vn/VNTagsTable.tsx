'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, ArrowUpDown, Tag } from 'lucide-react';
import type { VNTag } from '@/lib/vndb-stats-api';

interface VNTagsTableProps {
  tags?: VNTag[];
  showSpoilers: boolean;
  onShowSpoilersChange: (show: boolean) => void;
}

type SortField = 'name' | 'score' | 'weight' | 'importance';
type SortDir = 'asc' | 'desc';

export function VNTagsTable({ tags, showSpoilers, onShowSpoilersChange }: VNTagsTableProps) {
  const [sortField, setSortField] = useState<SortField>('weight');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const processedTags = useMemo(() => {
    if (!tags) return [];

    let filtered = showSpoilers ? tags : tags.filter(t => t.spoiler === 0);

    // Approximate total VNs in VNDB for IDF calculation
    const TOTAL_VNS = 50000;

    // Calculate importance (IDF - rarer tags are more important) and weight
    const withWeight = filtered.map(t => {
      // IDF: log(total / count) - rarer tags get higher importance
      const vnCount = t.vn_count || 1;
      const importance = Math.log(TOTAL_VNS / Math.max(vnCount, 1));
      // Weight: score * importance (high score + rare tag = high weight)
      const weight = t.score * importance;
      return { ...t, importance, weight };
    });

    // Normalize weight to 0-100 scale (top item = 100)
    const maxWeight = Math.max(...withWeight.map(t => t.weight), 1);
    const normalized = withWeight.map(t => ({
      ...t,
      weight: (t.weight / maxWeight) * 100,
    }));

    // Sort
    return normalized.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'score') cmp = a.score - b.score;
      else if (sortField === 'importance') cmp = a.importance - b.importance;
      else cmp = a.weight - b.weight;
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [tags, showSpoilers, sortField, sortDir]);

  const spoilerCount = tags?.filter(t => t.spoiler > 0).length || 0;

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  if (!tags || tags.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Tag className="w-5 h-5 text-primary-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Tags</h2>
          <span className="text-sm text-gray-400">({processedTags.length})</span>
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
            <span className="hidden sm:inline">{showSpoilers ? 'Hide' : 'Show'} </span>spoilers ({spoilerCount})
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
                <button onClick={() => handleSort('score')} className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase ml-auto">
                  Score <ArrowUpDown className="w-3 h-3" />
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
            {processedTags.map((tag) => (
              <tr key={tag.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 ${tag.spoiler > 0 ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                <td className="px-3 sm:px-4 py-2">
                  <Link
                    href={`/stats/tag/${tag.id}`}
                    className="text-sm text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                  >
                    {tag.name}
                    {tag.spoiler > 0 && <span className="ml-1 text-red-500">!</span>}
                  </Link>
                </td>
                <td className="px-2 sm:px-4 py-2 text-right text-sm text-gray-600 dark:text-gray-400">
                  {tag.score.toFixed(2)}
                </td>
                <td className="px-2 sm:px-4 py-2 text-right text-sm text-gray-600 dark:text-gray-400">
                  {tag.importance.toFixed(2)}
                </td>
                <td className="px-2 sm:px-4 py-2 text-right text-sm font-medium text-gray-900 dark:text-white">
                  {tag.weight.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
