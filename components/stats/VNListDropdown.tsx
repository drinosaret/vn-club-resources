'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Star, Loader2 } from 'lucide-react';
import {
  vndbStatsApi,
  type CategoryType,
  type VNListByCategoryResponse,
  type VNSearchResult,
} from '@/lib/vndb-stats-api';
import { LanguageFilter, LanguageFilterValue, filterByLanguage } from './LanguageFilter';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';

interface CategoryOption {
  value: string;
  label: string;
  count?: number;
}

interface VNListDropdownProps {
  /** Tag ID (e.g., "g106") or Trait ID (e.g., "i123") */
  entityId: string;
  /** Whether this is a tag or trait */
  entityType: 'tag' | 'trait';
  /** The type of category this dropdown filters by */
  categoryType: CategoryType;
  /** Available category options with their counts */
  categoryOptions: CategoryOption[];
  /** Label to display (e.g., "View VNs by Year") */
  label: string;
}

const PAGE_SIZE = 20;

export function VNListDropdown({
  entityId,
  entityType,
  categoryType,
  categoryOptions,
  label,
}: VNListDropdownProps) {
  const { preference } = useTitlePreference();
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [vns, setVns] = useState<VNSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [langFilter, setLangFilter] = useState<LanguageFilterValue>('ja');

  const filteredVNs = useMemo(() => {
    return vns.filter(vn => filterByLanguage(vn, langFilter));
  }, [vns, langFilter]);

  // Filter out options with 0 count
  const validOptions = categoryOptions.filter(opt => (opt.count ?? 1) > 0);

  // Set default selected category when expanded
  useEffect(() => {
    if (isExpanded && !selectedCategory && validOptions.length > 0) {
      // For scores, default to highest score with VNs
      // For other categories, default to first option
      if (categoryType === 'score') {
        const highestScore = validOptions.reduce((max, opt) =>
          parseInt(opt.value) > parseInt(max.value) ? opt : max
        );
        setSelectedCategory(highestScore.value);
      } else {
        setSelectedCategory(validOptions[0].value);
      }
    }
  }, [isExpanded, selectedCategory, validOptions, categoryType]);

  const fetchVNs = useCallback(async (categoryValue: string, loadMore: boolean = false) => {
    if (!categoryValue) return;

    setIsLoading(true);
    setError(null);

    try {
      const currentOffset = loadMore ? offset : 0;
      let response: VNListByCategoryResponse | null = null;

      if (entityType === 'tag') {
        response = await vndbStatsApi.getTagVNsByCategory(
          entityId,
          categoryType,
          categoryValue,
          PAGE_SIZE,
          currentOffset
        );
      } else {
        response = await vndbStatsApi.getTraitVNsByCategory(
          entityId,
          categoryType,
          categoryValue,
          PAGE_SIZE,
          currentOffset
        );
      }

      if (response) {
        if (loadMore) {
          setVns(prev => [...prev, ...response!.vns]);
        } else {
          setVns(response.vns);
        }
        setTotal(response.total);
        setOffset(currentOffset + response.vns.length);
        setHasMore(response.has_more);
      } else {
        setError('Backend not available');
      }
    } catch {
      setError('Failed to load VNs');
    } finally {
      setIsLoading(false);
    }
  }, [entityId, entityType, categoryType, offset]);

  // Fetch VNs when category changes
  useEffect(() => {
    if (isExpanded && selectedCategory) {
      setOffset(0);
      fetchVNs(selectedCategory, false);
    }
  }, [selectedCategory, isExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadMore = () => {
    if (selectedCategory && hasMore && !isLoading) {
      fetchVNs(selectedCategory, true);
    }
  };

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
    setVns([]);
    setOffset(0);
  };

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
    if (!isExpanded) {
      setVns([]);
      setOffset(0);
    }
  };

  if (validOptions.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-gray-100 dark:border-gray-700">
      {/* Toggle button */}
      <button
        onClick={toggleExpand}
        className="w-full flex items-center justify-between py-3 px-1 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
      >
        <span className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
          {label}
        </span>
        <span className="text-xs text-gray-400">
          {validOptions.length} categories
        </span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="pb-4 space-y-3">
          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedCategory || ''}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="flex-1 min-w-[140px] px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              {validOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} {opt.count !== undefined && `(${opt.count})`}
                </option>
              ))}
            </select>
            <LanguageFilter value={langFilter} onChange={setLangFilter} />
          </div>

          {/* VN list */}
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {error && (
              <div className="text-center py-4 text-sm text-red-500 dark:text-red-400">
                {error}
              </div>
            )}

            {!error && filteredVNs.length === 0 && !isLoading && (
              <div className="text-center py-4 text-sm text-gray-500 dark:text-gray-400">
                {vns.length > 0 && langFilter === 'ja'
                  ? 'No Japanese VNs. Try "All Languages".'
                  : 'No VNs found'}
              </div>
            )}

            {filteredVNs.map((vn) => (
              <Link
                key={vn.id}
                href={`/vn/${vn.id}`}
                scroll={true}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group"
              >
                <span className="text-sm text-gray-700 dark:text-gray-200 truncate flex-1 mr-2">
                  {getDisplayTitle({ title: vn.title, title_jp: vn.title_jp || vn.alttitle, title_romaji: vn.title_romaji }, preference)}
                </span>
                {vn.rating && (
                  <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                    <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                    {vn.rating.toFixed(1)}
                  </span>
                )}
              </Link>
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
              </div>
            )}
          </div>

          {/* Load more button */}
          {hasMore && !isLoading && (
            <button
              onClick={handleLoadMore}
              className="w-full py-2 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
            >
              Load More ({total - vns.length} remaining)
            </button>
          )}

          {/* Total count */}
          {filteredVNs.length > 0 && (
            <div className="text-xs text-center text-gray-400">
              Showing {filteredVNs.length}{langFilter === 'ja' && filteredVNs.length !== vns.length ? ` (${vns.length} total)` : ''} of {total} VNs
            </div>
          )}
        </div>
      )}
    </div>
  );
}
