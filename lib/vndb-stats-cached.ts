import useSWR, { SWRConfiguration, preload } from 'swr';
import {
  vndbStatsApi,
  BrowseFilters,
  BrowseResponse,
  BrowseStaffParams,
  BrowseStaffResponse,
  BrowseSeiyuuParams,
  BrowseSeiyuuResponse,
  BrowseProducerParams,
  BrowseProducersResponse,
  SimilarCharacter,
  type VNVoteStats as VNVoteStatsData,
} from './vndb-stats-api';

// Default SWR options for API caching
const DEFAULT_SWR_OPTIONS: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 60000, // Dedupe requests within 60s for better caching
  errorRetryCount: 2,
};

/**
 * Hook for browsing VNs with SWR caching
 * Keeps previous data during loading for smooth UI transitions
 */
export function useBrowseVNs(filters: BrowseFilters, enabled: boolean = true) {
  const cacheKey = enabled ? ['browse', JSON.stringify(filters)] : null;

  return useSWR<BrowseResponse>(
    cacheKey,
    () => vndbStatsApi.browseVNs(filters),
    {
      ...DEFAULT_SWR_OPTIONS,
      keepPreviousData: true, // Show stale data while fetching
    }
  );
}

/**
 * Hook for getting tag details with caching
 */
export function useTag(tagId: string | null) {
  return useSWR(
    tagId ? ['tag', tagId] : null,
    () => vndbStatsApi.getTag(tagId!),
    DEFAULT_SWR_OPTIONS
  );
}

/**
 * Hook for getting trait details with caching
 */
export function useTrait(traitId: string | null) {
  return useSWR(
    traitId ? ['trait', traitId] : null,
    () => vndbStatsApi.getTrait(traitId!),
    DEFAULT_SWR_OPTIONS
  );
}

/**
 * Hook for getting VN details with caching
 */
export function useVN(vnId: string | null) {
  return useSWR(
    vnId ? ['vn', vnId] : null,
    () => vndbStatsApi.getVN(vnId!),
    DEFAULT_SWR_OPTIONS
  );
}

/**
 * Hook for getting character details with caching
 */
export function useCharacter(charId: string | null) {
  return useSWR(
    charId ? ['character', charId] : null,
    () => vndbStatsApi.getCharacter(charId!),
    DEFAULT_SWR_OPTIONS
  );
}

/**
 * Hook for getting similar characters with caching
 */
export function useSimilarCharacters(charId: string | null, limit: number = 10) {
  return useSWR<SimilarCharacter[]>(
    charId ? ['similar-characters', charId, limit] : null,
    () => vndbStatsApi.getSimilarCharacters(charId!, limit),
    DEFAULT_SWR_OPTIONS
  );
}

/**
 * Hook for getting VN characters with caching
 */
export function useVNCharacters(vnId: string | null) {
  return useSWR(
    vnId ? ['vn-characters', vnId] : null,
    () => vndbStatsApi.getVNCharacters(vnId!),
    {
      ...DEFAULT_SWR_OPTIONS,
      dedupingInterval: 30000, // 30 seconds dedup for character lists
    }
  );
}

/**
 * Hook for getting global stats with caching
 */
export function useGlobalStats() {
  return useSWR(
    'globalStats',
    () => vndbStatsApi.getGlobalStats(),
    {
      ...DEFAULT_SWR_OPTIONS,
      dedupingInterval: 60000, // Only refetch every minute
    }
  );
}

/**
 * Hook for browsing tags with caching
 */
export function useBrowseTags(params: Parameters<typeof vndbStatsApi.browseTags>[0] = {}, enabled = true) {
  return useSWR(
    enabled ? ['browseTags', JSON.stringify(params)] : null,
    () => vndbStatsApi.browseTags(params),
    { ...DEFAULT_SWR_OPTIONS, keepPreviousData: true }
  );
}

/**
 * Hook for browsing traits with caching
 */
export function useBrowseTraits(params: Parameters<typeof vndbStatsApi.browseTraits>[0] = {}, enabled = true) {
  return useSWR(
    enabled ? ['browseTraits', JSON.stringify(params)] : null,
    () => vndbStatsApi.browseTraits(params),
    { ...DEFAULT_SWR_OPTIONS, keepPreviousData: true }
  );
}

/**
 * Hook for browsing staff with caching
 */
export function useBrowseStaff(params: BrowseStaffParams = {}, enabled = true) {
  return useSWR<BrowseStaffResponse>(
    enabled ? ['browseStaff', JSON.stringify(params)] : null,
    () => vndbStatsApi.browseStaff(params),
    { ...DEFAULT_SWR_OPTIONS, keepPreviousData: true }
  );
}

/**
 * Hook for browsing seiyuu with caching
 */
export function useBrowseSeiyuu(params: BrowseSeiyuuParams = {}, enabled = true) {
  return useSWR<BrowseSeiyuuResponse>(
    enabled ? ['browseSeiyuu', JSON.stringify(params)] : null,
    () => vndbStatsApi.browseSeiyuu(params),
    { ...DEFAULT_SWR_OPTIONS, keepPreviousData: true }
  );
}

/**
 * Hook for browsing producers with caching
 */
export function useBrowseProducers(params: BrowseProducerParams = {}, enabled = true) {
  return useSWR<BrowseProducersResponse>(
    enabled ? ['browseProducers', JSON.stringify(params)] : null,
    () => vndbStatsApi.browseProducers(params),
    { ...DEFAULT_SWR_OPTIONS, keepPreviousData: true }
  );
}

const voteStatsFetcher = (vnId: string) => vndbStatsApi.getVNVoteStats(vnId);

export function useVNVoteStats(vnId: string | null) {
  return useSWR<VNVoteStatsData | null>(
    vnId ? ['vote-stats', vnId] : null,
    () => voteStatsFetcher(vnId!),
    { ...DEFAULT_SWR_OPTIONS, revalidateIfStale: false },
  );
}

export function prefetchVoteStats(vnId: string) {
  preload(['vote-stats', vnId], () => voteStatsFetcher(vnId));
}
