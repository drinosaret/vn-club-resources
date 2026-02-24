/**
 * VNDB Stats API client for frontend.
 *
 * ============================================================================
 * CRITICAL: ALL VNDB DATA MUST COME FROM LOCAL DATABASE DUMPS
 * ============================================================================
 *
 * VNDB provides absolutely ALL public data in their database dumps. This includes:
 * - VN metadata (titles, descriptions, ratings, platforms, languages)
 * - Characters, traits, voice actors
 * - Tags and tag associations
 * - Producers, developers, publishers, staff
 * - User lists (votes, dates, labels) - this is PUBLIC data on VNDB
 * - Releases, relations, screenshots
 *
 * There is NO legitimate reason to call the VNDB API for data retrieval.
 * DO NOT ADD VNDB API CALLS. EVER.
 *
 * Data flow: VNDB Daily Dumps → PostgreSQL (Backend) → This API Client → UI
 *
 * The backend server (vndb-stats-backend) downloads VNDB database dumps daily
 * and imports them into PostgreSQL. This client fetches data ONLY from the
 * backend, which serves data from the local database.
 *
 * - DO NOT add direct VNDB API calls
 * - DO NOT add "fallback" mechanisms to call VNDB API
 * - ALL data is available in the local database dumps
 * - If something seems missing, check the backend/database first
 * ============================================================================
 */

import { getBackendUrlOptional } from './config';

// Lazy initialization: avoid crashing at import time when env var is missing
// (e.g., during static export builds that don't need the backend)
let _backendUrl: string | undefined;
function getBackendUrlLazy(): string {
  if (!_backendUrl) {
    _backendUrl = getBackendUrlOptional();
    if (!_backendUrl) {
      throw new Error(
        'NEXT_PUBLIC_VNDB_STATS_API environment variable is required. ' +
        'Set it in .env.local or your deployment environment.'
      );
    }
  }
  return _backendUrl;
}

// Import correlation ID for request tracing
import { getCorrelationId } from './log-reporter';

// ============ Batch Result Cache ============
// Cache for individual tag/trait lookups to avoid redundant fetches
// Used by getTags() and getTraits() batch methods
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const BATCH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minute cache for batch results
const MAX_CACHE_SIZE = 2000; // Prevent unbounded memory growth
const tagCache = new Map<string, CacheEntry<TagDetail>>();
const traitCache = new Map<string, CacheEntry<TraitDetail>>();

/** Evict the oldest 25% of entries from a cache map by timestamp */
function evictOldest<T>(cache: Map<string, CacheEntry<T>>): void {
  const evictCount = Math.ceil(cache.size / 4);
  const entries = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
  for (let i = 0; i < evictCount; i++) {
    cache.delete(entries[i][0]);
  }
}

function getCachedTag(tagId: string): TagDetail | null {
  const entry = tagCache.get(tagId);
  if (entry && (Date.now() - entry.timestamp) < BATCH_CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

function setCachedTag(tagId: string, data: TagDetail): void {
  if (tagCache.size >= MAX_CACHE_SIZE) {
    evictOldest(tagCache);
  }
  tagCache.set(tagId, { data, timestamp: Date.now() });
}

function getCachedTrait(traitId: string): TraitDetail | null {
  const entry = traitCache.get(traitId);
  if (entry && (Date.now() - entry.timestamp) < BATCH_CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

function setCachedTrait(traitId: string, data: TraitDetail): void {
  if (traitCache.size >= MAX_CACHE_SIZE) {
    evictOldest(traitCache);
  }
  traitCache.set(traitId, { data, timestamp: Date.now() });
}

// ============ Types ============

export interface UserInfo {
  uid: string;
  username: string;
}

export interface StatsSummary {
  total_vns: number;
  completed: number;
  playing: number;
  dropped: number;
  wishlist: number;
  total_votes: number;
  average_score: number;
  score_stddev: number;
  estimated_hours: number;
  // New vnstat.net-style fields
  global_average?: number;
  user_vs_global_diff?: number;
  score_min?: number;
  score_max?: number;
  average_hours_per_vn?: number;
  vns_with_length_data?: number;  // How many VNs have length info (for context)
}

export interface CategoryStats {
  count: number;
  avg_rating: number;
  jp_count?: number;  // Japanese-original VN count (olang='ja')
}

export interface YearWithRating {
  year: number;
  count: number;
  avg_rating: number;
  jp_count?: number;  // Japanese-original VN count (olang='ja')
}

// ============ User Stats Breakdown Types ============

export interface ProducerBreakdown {
  id: string;
  name: string;
  original?: string | null;  // Romanized/latin name
  type: string | null;  // "co" (company), "in" (individual), "ng" (amateur group)
  count: number;
  avg_rating: number;
  global_avg_rating?: number | null;  // Global average rating for VNs from this producer
  weighted_score?: number | null;  // Bayesian-weighted score for ranking
}

export interface StaffBreakdown {
  id: string;
  name: string;
  original?: string | null;  // Romanized/latin name
  role: string;  // "scenario", "art", "music", "songs", "director"
  count: number;
  avg_rating: number;
  global_avg_rating?: number | null;  // Global average rating for VNs this staff worked on
  weighted_score?: number | null;  // Bayesian-weighted score for ranking
}

export interface SeiyuuBreakdown {
  id: string;
  name: string;
  original?: string | null;  // Romanized/latin name
  count: number;
  avg_rating: number;
  global_avg_rating?: number | null;  // Global average rating for VNs this seiyuu voiced in
  weighted_score?: number | null;  // Bayesian-weighted score for ranking
}

export interface TraitBreakdown {
  id: number;
  name: string;
  group_name: string | null;
  count: number;  // Number of characters with this trait
  vn_count: number;  // Number of VNs with characters having this trait
  frequency: number;  // Percentage of user's VNs (0-100)
  avg_rating?: number | null;  // User's average rating for VNs with this trait
  global_avg_rating?: number | null;  // Global average rating for VNs with this trait
  weighted_score?: number | null;  // Bayesian-weighted score for ranking
}

export interface MonthlyActivity {
  month: string;  // "YYYY-MM"
  completed: number;  // VNs finished this month
  added: number;  // VNs added to list this month
  hours: number;  // Estimated hours for VNs finished
  avg_score: number | null;  // Average user score for VNs finished
}

export interface UserStats {
  user: UserInfo;
  summary: StatsSummary;
  score_distribution: Record<string, number>;
  release_year_distribution: Record<string, number>;
  monthly_activity: MonthlyActivity[];
  length_distribution: Record<string, number>;
  platform_breakdown: Record<string, number>;
  // New vnstat.net-style extended stats
  length_distribution_detailed?: Record<string, CategoryStats>;
  age_rating_distribution?: Record<string, CategoryStats>;
  release_year_with_ratings?: YearWithRating[];
  // Detailed breakdowns for tabs
  developers_breakdown?: ProducerBreakdown[];
  publishers_breakdown?: ProducerBreakdown[];
  staff_breakdown?: StaffBreakdown[];
  seiyuu_breakdown?: SeiyuuBreakdown[];
  traits_breakdown?: TraitBreakdown[];
  last_updated?: string;
}

// ============ User VN List Types ============

export interface VNDBListItem {
  id: string;  // VN ID e.g., "v17"
  vote?: number;  // User's vote (10-100 scale)
  labels?: Array<{ id: number; label?: string }>;
  added?: number;  // Unix timestamp
  started?: string;  // ISO date
  finished?: string;  // ISO date
  vn?: {
    title: string;
    title_jp?: string;
    title_romaji?: string;
    image?: { url: string; sexual?: number };
    rating?: number;
    released?: string;
    olang?: string;
  };
}

export interface UserVNListResponse {
  items: VNDBListItem[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface TagStats {
  tag_id: number;
  name: string;
  count: number;
  avg_score: number;
  bayesian_score?: number;  // Damped mean score for ranking
  weighted_score?: number;  // bayesian * log2(count+1) for confidence-weighted ranking
  global_avg_score?: number;  // VNDB's global avg for this tag
}

export interface TagPreference {
  tag_id: number;
  name: string;
  user_avg: number;
  global_avg: number;
}

export interface TagAnalytics {
  top_tags: TagStats[];
  tag_preferences: {
    loved: TagPreference[];
    avoided: TagPreference[];
  };
  tag_trends: Array<{ year: number; top_tags: string[] }>;
  tag_comparison_to_global: {
    more_than_average: string[];
    less_than_average: string[];
  };
}

export interface Recommendation {
  vn_id: string;
  title: string;
  image_url: string | null;
  image_sexual?: number;
  rating: number | null;
  released: string | null;
  score: number;
  reasons: string[];
  tag_match_score: number | null;
  cf_score: number | null;
  olang?: string;
  length?: number; // 1-5 scale
  // Method-specific matched entities
  matched_tags?: string[];
  matched_traits?: string[];
  matched_staff?: string[];
  matched_seiyuu?: string[];  // Voice actors (separate from staff)
  matched_producer?: string;
  // Source traceability for specific methods
  similar_to_titles?: string[]; // For Similar Novels: which favorites this is similar to
  similar_user_count?: number;  // For Similar Users: how many similar users liked this
  // Multi-signal combined recommendations
  methods_matched?: number;  // How many recommendation methods scored this VN (0-9)
  signal_scores?: Record<string, number>;  // Individual scores from each method
}

export interface RecommendationsResponse {
  method: string;
  recommendations: Recommendation[];
  excluded_count: number;
  dropped_count?: number;
  blacklisted_count?: number;
  total_excluded_message?: string;
}

export type RecommendationMethod =
  | 'hybrid'
  | 'combined'
  | 'tag'
  | 'collaborative'
  | 'tags_affinity'
  | 'traits_affinity'
  | 'staff_affinity'
  | 'seiyuu_affinity'
  | 'producer_affinity'
  | 'similar_novels'
  | 'similar_users';

export interface RecommendationFilters {
  method?: RecommendationMethod;
  limit?: number;
  lengthFilter?: string;
  spoilerLevel?: number;
  minRating?: number;
  skipExplanations?: boolean;
  /** Optional abort signal for UI-driven cancellation (tab switches, etc.). */
  signal?: AbortSignal;
  /**
   * Allow falling back to the slow/limited direct VNDB client when the backend is unavailable.
   * Defaults to false because the direct client is rate-limited and often too slow for UI tabs.
   */
  allowClientFallback?: boolean;
}

export interface UserLookup {
  uid: string;
  username: string;
}

// ============ Comparison Types ============

export interface SharedVNScore {
  vn_id: string;
  title: string;
  title_jp?: string;
  image_url: string | null;
  user1_score: number;
  user2_score: number;
}

export interface UserComparisonResponse {
  user1: UserInfo;
  user2: UserInfo;
  compatibility_score: number;
  shared_vns: number;
  score_correlation: number;
  shared_favorites: SharedVNScore[];
  biggest_disagreements: SharedVNScore[];
  common_tags: string[];
  differing_tastes: {
    user1_prefers: string[];
    user2_prefers: string[];
  };
  // Enhanced comparison metrics
  tag_similarity?: number | null;  // 0-1 tag preference similarity
  confidence?: number | null;  // 0-1 reliability of comparison
  jaccard_similarity?: number | null;  // List overlap metric
  cosine_similarity?: number | null;  // Rating vector similarity
  rating_agreement?: number | null;  // 0-1 how closely shared VNs are rated
}

export interface SimilarUser {
  uid: string;
  username: string;
  compatibility: number;  // 0-1 similarity score
  shared_vns: number;
  tag_similarity: number | null;
  total_vns: number;
  avg_score: number | null;
}

export interface VNTag {
  id: string;
  name: string;
  category?: string;
  score: number;
  spoiler: number;
  vn_count?: number;
}

export interface VNRelation {
  id: string;
  title: string;
  title_jp?: string; // Japanese title (kanji/kana)
  title_romaji?: string; // Romanized title
  relation: string; // "prequel", "sequel", "side story", "parent", etc.
  relation_official: boolean;
  image_url?: string;
  image_sexual?: number;
  rating?: number;
  olang?: string;
}

export interface ExtlinkInfo {
  site: string;
  url: string;
  label: string;
}

export interface VNDetail {
  id: string;
  title: string;
  title_jp?: string;      // Original Japanese title (kanji/kana)
  title_romaji?: string;  // Romanized title
  aliases?: string[];
  description?: string;
  image_url?: string;
  image_sexual?: number;
  released?: string;
  length?: number;
  rating?: number;
  votecount?: number;
  developers?: Array<{ id: string; name: string; original?: string }>;
  platforms?: string[];
  languages?: string[];
  tags?: VNTag[];
  relations?: VNRelation[];
  olang?: string;         // Original language (e.g., "ja" for Japanese)
  updated_at?: string;
  links?: ExtlinkInfo[];
  shops?: ExtlinkInfo[];
}

// ============ Similar VNs Types ============

export interface SimilarVN {
  vn_id: string;
  title: string;
  title_jp?: string; // Japanese title (kanji/kana)
  title_romaji?: string; // Romanized title
  image_url?: string;
  image_sexual?: number;
  rating?: number;
  similarity: number;
  olang?: string;
  user_count?: number; // For collaborative filtering: number of users who rated both highly
}

export interface SimilarVNsResponse {
  content_similar: SimilarVN[]; // Tag-based cosine similarity
  users_also_read: SimilarVN[]; // Collaborative filtering based on user ratings
}

// ============ VN Vote Stats Types ============

export interface VNMonthlyVotes {
  month: string;
  count: number;
  cumulative: number;
}

export interface VNMonthlyScore {
  month: string;
  avg_score: number;
  cumulative_avg: number;
  vote_count: number;
}

export interface DeveloperRankContext {
  developer_id: string;
  developer_name: string;
  developer_name_original?: string | null;
  rank: number;
  total: number;
  total_all?: number | null;
}

export interface GenrePercentileContext {
  tag_id: number;
  tag_name: string;
  percentile: number;
  total_in_genre: number;
  jp_count: number;
}

export interface LengthComparisonContext {
  vn_score: number;
  length_avg_score: number;
  length_label: string;
  count_in_length: number;
  jp_count: number;
}

export interface ComparativeContext {
  developer_rank?: DeveloperRankContext | null;
  genre_percentile?: GenrePercentileContext | null;
  length_comparison?: LengthComparisonContext | null;
}

export interface GlobalMedians {
  median_rating: number;
  median_votecount: number;
  p75_rating: number;
  p75_votecount: number;
}

export interface VNVoteStats {
  vn_id: string;
  total_votes: number;
  average_score: number | null;
  score_distribution: Record<string, number>;
  votes_over_time: VNMonthlyVotes[];
  score_over_time: VNMonthlyScore[];
  context?: ComparativeContext | null;
  global_medians?: GlobalMedians | null;
}

// ============ Character & Traits Types ============

export interface CharacterTrait {
  id: string;
  name: string;
  group_id?: string;
  group_name?: string;
  spoiler: number; // 0=none, 1=minor, 2=major
}

export interface VNCharacter {
  id: string;
  name: string;
  original?: string;
  image_url?: string;
  role: string; // "main", "primary", "side", "appears"
  spoiler: number; // 0=none, 1=minor, 2=major
  traits: CharacterTrait[];
}

export interface CharacterDetail {
  id: string;
  name: string;
  original?: string;
  aliases?: string[];
  description?: string;
  image_url?: string;
  image_sexual?: number;
  sex?: string;         // "m", "f", "b" (both)
  blood_type?: string;  // "a", "b", "ab", "o"
  height?: number;      // cm
  weight?: number;      // kg
  bust?: number;
  waist?: number;
  hips?: number;
  cup?: string;
  age?: number;
  birthday?: number[];  // [month, day] or [month]
  traits: CharacterTrait[];
  vns: Array<{
    id: string;
    title: string;
    title_jp?: string;
    title_romaji?: string;
    role: string;
    image_url?: string;
    image_sexual?: number;
  }>;
  voiced_by?: Array<{
    id: string;
    name: string;
    original?: string;
    note?: string;
  }>;
}

export interface SimilarCharacter {
  id: string;
  name: string;
  original?: string;
  image_url?: string;
  image_sexual?: number;
  similarity: number;  // 0-1, based on shared traits
  shared_traits: string[];  // Names of shared traits
  vn_title?: string;  // Primary VN name for context
  vn_title_jp?: string;  // Japanese title of primary VN
  vn_title_romaji?: string;  // Romanized title of primary VN
  olang?: string;  // Original language of primary VN
}

export interface AggregatedTrait {
  id: string;
  name: string;
  group_name?: string;
  spoiler: number;
  character_count: number;
  global_char_count?: number; // Total characters with this trait globally (for IDF)
  importance: number; // IDF-based importance (rarer = more important)
  weight: number; // calculated weight for sorting
}

export interface VNSearchResult {
  id: string;
  title: string;
  alttitle?: string;  // From VNDB API
  title_jp?: string;  // From backend
  title_romaji?: string;  // Romanized title from backend
  image_url?: string;
  image_sexual?: number;
  released?: string;
  rating?: number;
  votecount?: number;
  olang?: string;
  description?: string;  // Truncated description snippet (up to 200 chars)
}

export interface VNSearchResponse {
  results: VNSearchResult[];
  more: boolean;
  count: number;
}

// ============ Browse Types (Enhanced Search) ============

export interface BrowseFilters {
  q?: string;                    // Title search
  first_char?: string;           // A-Z or # for non-alpha
  tags?: string;                 // Comma-separated tag IDs to include
  exclude_tags?: string;         // Comma-separated tag IDs to exclude
  traits?: string;               // Comma-separated trait IDs to include
  exclude_traits?: string;       // Comma-separated trait IDs to exclude
  tag_mode?: 'and' | 'or';       // Tag/trait matching mode
  include_children?: boolean;    // Include child tags in filter (matches VNDB tag page behavior)
  year_min?: number;
  year_max?: number;
  min_rating?: number;
  max_rating?: number;
  min_votecount?: number;
  max_votecount?: number;
  // Multi-select filters (comma-separated values)
  length?: string;               // very_short, short, medium, long, very_long (comma-separated)
  exclude_length?: string;       // Exclude lengths (comma-separated)
  minage?: string;               // all_ages, teen, adult (comma-separated)
  exclude_minage?: string;       // Exclude age ratings (comma-separated)
  devstatus?: string;            // 0=finished, 1=in_dev, 2=cancelled, -1=all (comma-separated)
  exclude_devstatus?: string;    // Exclude dev statuses (comma-separated)
  olang?: string;                // ja, en, zh, etc. (comma-separated)
  exclude_olang?: string;        // Exclude languages (comma-separated)
  platform?: string;             // win, lin, mac, web, etc. (comma-separated)
  exclude_platform?: string;     // Exclude platforms (comma-separated)
  spoiler_level?: number;        // Max spoiler level for tag/trait search: 0=none (default), 1=minor, 2=major
  // Entity filters (staff, seiyuu, developer, publisher, producer)
  staff?: string;                // Comma-separated staff IDs to filter by
  seiyuu?: string;               // Comma-separated seiyuu IDs to filter by
  developer?: string;            // Comma-separated developer (producer) IDs to filter by
  publisher?: string;            // Comma-separated publisher (producer) IDs to filter by
  producer?: string;             // Comma-separated producer IDs (matches developer OR publisher role)
  sort?: 'rating' | 'released' | 'votecount' | 'title' | 'random';
  sort_order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface BrowseResponse {
  results: VNSearchResult[];
  total: number;
  total_with_spoilers?: number;  // Total count including all spoiler levels (when tag/trait filtering)
  page: number;
  pages: number;
  query_time?: number;           // Query execution time in seconds
}

export interface FilterSearchResult {
  id: string;
  name: string;
  original: string | null;  // Romanized/latin name for staff/producers
  type: 'tag' | 'trait' | 'staff' | 'seiyuu' | 'developer' | 'publisher';
  category: string | null;
  count: number;
}

export interface FilterSearchResponse {
  results: FilterSearchResult[];
}

// ============ Browse Entity Types ============

export interface BrowseEntityParams {
  q?: string;
  first_char?: string;
  sort?: string;
  sort_order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface BrowseTagParams extends BrowseEntityParams {
  category?: string;           // cont, tech, ero
  sort?: 'name' | 'vn_count';
}

export interface BrowseTraitParams extends BrowseEntityParams {
  group_name?: string;
  sort?: 'name' | 'char_count';
}

export interface BrowseStaffParams extends BrowseEntityParams {
  role?: string;               // scenario, art, music, songs, director, staff
  lang?: string;
  gender?: string;
  sort?: 'name' | 'vn_count';
}

export interface BrowseSeiyuuParams extends BrowseEntityParams {
  lang?: string;
  gender?: string;
  sort?: 'name' | 'vn_count' | 'character_count';
}

export interface BrowseProducerParams extends BrowseEntityParams {
  type?: string;               // co (company), in (individual), ng (amateur group)
  lang?: string;
  role?: string;               // developer, publisher (for unified producers endpoint)
  sort?: 'name' | 'vn_count';
}

export interface BrowseTagItem {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  vn_count: number;
}

export interface BrowseTraitItem {
  id: number;
  name: string;
  description: string | null;
  group_name: string | null;
  char_count: number;
}

export interface BrowseStaffItem {
  id: string;
  name: string;
  original: string | null;
  gender: string | null;
  lang: string | null;
  vn_count: number;
  roles: string[];
  description: string | null;
}

export interface BrowseSeiyuuItem {
  id: string;
  name: string;
  original: string | null;
  gender: string | null;
  lang: string | null;
  vn_count: number;
  character_count: number;
  description: string | null;
}

export interface BrowseProducerItem {
  id: string;
  name: string;
  original: string | null;
  type: string | null;
  lang: string | null;
  vn_count: number;
  description: string | null;
}

export interface BrowseEntityResponse<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export type BrowseTagsResponse = BrowseEntityResponse<BrowseTagItem>;
export type BrowseTraitsResponse = BrowseEntityResponse<BrowseTraitItem>;
export type BrowseStaffResponse = BrowseEntityResponse<BrowseStaffItem>;
export type BrowseSeiyuuResponse = BrowseEntityResponse<BrowseSeiyuuItem>;
export type BrowseProducersResponse = BrowseEntityResponse<BrowseProducerItem>;

export interface DataStatus {
  status: string;
  has_data: boolean;
  vn_count: number;
  last_import?: string;
  next_update?: string;
}

export interface GlobalStats {
  total_vns: number;
  total_with_ratings: number;
  average_rating: number;
  score_distribution: Record<string, number>;
  release_year_distribution: Record<string, number>;
  release_year_with_ratings: YearWithRating[];
  length_distribution: Record<string, CategoryStats>;
  age_rating_distribution: Record<string, CategoryStats>;
  last_updated?: string;
}

export interface TopVN {
  id: string;
  title: string;
  alttitle?: string;
  image_url?: string;
  image_sexual?: number;
  released?: string;
  rating?: number;
  votecount?: number;
  rank: number;
  olang?: string;
}

// ============ Tag Detail Types ============

export interface TagDetail {
  id: string;
  name: string;
  description?: string;
  category?: string;
  vn_count?: number;
  aliases?: string[];
}

export interface TagVN {
  id: string;
  title: string;
  alttitle?: string;
  title_jp?: string;  // Backend returns title_jp directly
  title_romaji?: string;
  image_url?: string;
  image_sexual?: number;
  released?: string;
  rating?: number;
  votecount?: number;
  length?: number;
  minage?: number;
  tags?: Array<{ id: string; name: string; rating: number; vn_count?: number; spoiler?: number }>;
  olang?: string;
}

export interface TagVNsResponse {
  tag: TagDetail;
  vns: TagVN[];
  total: number;
  page: number;
  pages: number;
  more: boolean;
}

export interface TraitVNsWithTagsResponse {
  vns: TagVN[];
  total: number;
  page: number;
  pages: number;
}

export interface SimilarTag {
  id: string;
  name: string;
  similarity: number; // 0-1, based on Jaccard similarity of VN overlap
  shared_vn_count: number;
}

export interface SimilarTrait {
  id: string;
  name: string;
  group_name?: string;
  frequency: number; // How often this trait appears in characters of VNs with this tag
  character_count: number;
}

export interface TagParent {
  id: string;
  name: string;
}

export interface TagChild {
  id: string;
  name: string;
  vn_count?: number;
}

export interface TraitParent {
  id: string;
  name: string;
}

export interface TraitChild {
  id: string;
  name: string;
  char_count?: number;
}

export interface TagStatsData {
  score_distribution: Record<string, number>;
  score_distribution_jp?: Record<string, number>;  // JP-original VN counts per score
  release_year_distribution: Record<string, number>;
  release_year_with_ratings?: YearWithRating[];  // Includes jp_count
  length_distribution: Record<string, CategoryStats>;
  age_rating_distribution: Record<string, CategoryStats>;
  average_rating: number;
  total_votes: number;
  total_users: number;
  last_updated?: string;
}

// ============ Trait Detail Types ============

export interface TraitDetail {
  id: string;
  name: string;
  description?: string;
  group_id?: string;
  group_name?: string;
  char_count?: number;
  aliases?: string[];
  applicable?: boolean;  // False for meta/category traits that can't be directly applied
}

export interface TraitCharacterVNInfo {
  id: string;
  title: string;
  title_jp?: string;
  title_romaji?: string;
  olang?: string;
}

export interface TraitCharacter {
  id: string;
  name: string;
  original?: string;
  image_url?: string;
  image_sexual?: number;
  sex?: string;
  vns: TraitCharacterVNInfo[];
}

export interface TraitCharactersResponse {
  characters: TraitCharacter[];
  total: number;
  page: number;
  pages: number;
}

export interface TraitStatsData {
  score_distribution: Record<string, number>;
  score_distribution_jp?: Record<string, number>;  // JP-original VN counts per score
  release_year_distribution: Record<string, number>;
  release_year_with_ratings?: YearWithRating[];  // Includes jp_count
  length_distribution: Record<string, CategoryStats>;
  age_rating_distribution: Record<string, CategoryStats>;
  average_rating: number;
  total_vns: number;
  total_characters: number;
  last_updated?: string;
}

export interface SimilarTraitResult {
  id: string;
  name: string;
  group_name?: string;
  similarity: number;
  shared_character_count: number;
}

export interface RelatedTag {
  id: string;
  name: string;
  frequency: number;
  vn_count: number;
}

// ============ Producer Detail Types ============

export interface ProducerDetail {
  id: string;
  name: string;
  original?: string;  // Original language name
  type?: string;  // "co" (company), "in" (individual), "ng" (amateur group)
  lang?: string;  // Primary language
  description?: string;
  vn_count: number;
  aliases?: string[];
}

export interface ProducerStatsData {
  producer: ProducerDetail;
  average_rating: number | null;
  bayesian_rating: number | null;
  total_votes: number;
  total_vns: number;
  score_distribution: Record<string, number>;
  score_distribution_jp?: Record<string, number>;  // JP-original VN counts per score
  release_year_distribution: Record<string, number>;
  release_year_with_ratings: YearWithRating[];
  length_distribution: Record<string, CategoryStats>;
  age_rating_distribution: Record<string, CategoryStats>;
  last_updated?: string;
}

export interface ProducerVNsResponse {
  vns: VNSearchResult[];
  total: number;
  page: number;
  pages: number;
}

export interface ProducerVNsWithTagsResponse {
  vns: TagVN[];
  total: number;
  page: number;
  pages: number;
}

export interface SimilarProducerResult {
  id: string;
  name: string;
  original?: string | null;  // Romanized/latin name
  type?: string;
  vn_count: number;
  shared_vns: number;
  similarity: number;
}

// ============ Staff Detail Types ============

export interface StaffDetail {
  id: string;
  name: string;
  original?: string | null;  // Original language name
  lang?: string | null;  // Primary language
  gender?: string | null;
  description?: string | null;
  vn_count: number;
}

export interface StaffStatsData {
  staff: StaffDetail;
  average_rating: number | null;
  bayesian_rating: number | null;
  total_votes: number;
  total_vns: number;
  role_breakdown: Record<string, number>;  // role -> count
  score_distribution: Record<string, number>;
  score_distribution_jp?: Record<string, number>;  // JP-original VN counts per score
  release_year_distribution: Record<string, number>;
  release_year_with_ratings: YearWithRating[];
  length_distribution: Record<string, CategoryStats>;
  age_rating_distribution: Record<string, CategoryStats>;
  last_updated?: string;
}

export interface StaffVNsResponse {
  vns: VNSearchResult[];
  total: number;
  page: number;
  pages: number;
}

export interface StaffVNsWithTagsResponse {
  vns: TagVN[];
  total: number;
  page: number;
  pages: number;
}

// ============ Seiyuu Detail Types ============

export interface SeiyuuStatsData {
  staff: StaffDetail;
  average_rating: number | null;
  bayesian_rating: number | null;
  total_votes: number;
  total_vns: number;
  character_count: number;
  score_distribution: Record<string, number>;
  score_distribution_jp?: Record<string, number>;  // JP-original VN counts per score
  release_year_distribution: Record<string, number>;
  release_year_with_ratings: YearWithRating[];
  length_distribution: Record<string, CategoryStats>;
  age_rating_distribution: Record<string, CategoryStats>;
  last_updated?: string;
}

export interface SeiyuuVNsResponse {
  vns: VNSearchResult[];
  total: number;
  page: number;
  pages: number;
}

export interface SeiyuuVNsWithTagsResponse {
  vns: TagVN[];
  total: number;
  page: number;
  pages: number;
}

export interface SeiyuuCharacterVNInfo {
  id: string;
  title: string;
  title_jp?: string;
  title_romaji?: string;
}

export interface SeiyuuVoicedCharacter {
  id: string;
  name: string;
  original?: string;
  image_url?: string;
  image_sexual?: number;
  sex?: string;
  vn_count: number;
  vns: SeiyuuCharacterVNInfo[];
  note?: string;
}

export interface SeiyuuCharactersResponse {
  characters: SeiyuuVoicedCharacter[];
  total: number;
  page: number;
  pages: number;
}

// ============ VN List by Category Types ============

export interface VNListByCategoryResponse {
  vns: VNSearchResult[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export type CategoryType = 'release_year' | 'length' | 'score' | 'age_rating';

// ============ Data Source Tracking ============

/**
 * Indicates the source of API data.
 * - 'backend': Data from backend server with full VNDB database dumps (accurate)
 * - 'fallback': Data from direct VNDB API calls (limited, may be inaccurate)
 */
export type DataSource = 'backend' | 'fallback';

/**
 * Wrapper for API responses that includes data source information.
 * UI components should check `source` and display warnings when using fallback.
 */
export interface ApiResponseWithSource<T> {
  data: T;
  source: DataSource;
  warning?: string;
}

// ============================================================================
// REMOVED: VNDBDirectClient class was here
// ============================================================================
// The VNDBDirectClient class that called the VNDB API directly has been REMOVED.
// ALL data MUST come from the local PostgreSQL database via the backend.
//
// If you need data that was previously fetched via VNDB API:
// 1. Check the backend API endpoints at /api/v1/...
// 2. All VNDB data is available in the database dumps
// 3. DO NOT re-add VNDB API calls under any circumstances
// ============================================================================

// ============ Main API Class ============
// ALL data comes from the backend (local PostgreSQL with VNDB dumps).
// There is no fallback to VNDB API - the backend is REQUIRED.

// Module-level cache for backend availability (persists across API calls)
let _backendAvailableCache: { available: boolean; timestamp: number; failureCount: number } | null = null;
const HEALTH_CACHE_TTL_MS = 60000; // 60 seconds
const HEALTH_STALE_TTL_MS = 120000; // 2 minutes
const HEALTH_MAX_BACKOFF_MS = 60000; // Max 60 seconds between retries

// Calculate exponential backoff delay based on failure count
function getHealthCheckBackoffMs(failureCount: number): number {
  // Exponential backoff: 5s, 10s, 20s, 40s, 60s (max)
  const baseDelay = 5000;
  const delay = baseDelay * Math.pow(2, Math.min(failureCount - 1, 4));
  return Math.min(delay, HEALTH_MAX_BACKOFF_MS);
}

class VNDBStatsAPI {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    // Defer URL resolution to allow static export builds where env var isn't set
    this.baseUrl = baseUrl ?? '';
  }

  private getBaseUrl(): string {
    if (!this.baseUrl) {
      this.baseUrl = getBackendUrlLazy();
    }
    return this.baseUrl;
  }

  private async checkBackendAvailable(): Promise<boolean> {
    const now = Date.now();

    // Use cached result if still valid (success case)
    if (_backendAvailableCache?.available && (now - _backendAvailableCache.timestamp) < HEALTH_CACHE_TTL_MS) {
      return true;
    }

    // Apply exponential backoff for failed health checks
    if (_backendAvailableCache && !_backendAvailableCache.available) {
      const backoffMs = getHealthCheckBackoffMs(_backendAvailableCache.failureCount);
      if ((now - _backendAvailableCache.timestamp) < backoffMs) {
        // Still in backoff period, return cached failure without making request
        return false;
      }
    }

    const healthUrl = `${this.getBaseUrl()}/health`;

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      // Success - reset failure count
      _backendAvailableCache = { available: response.ok, timestamp: now, failureCount: 0 };
    } catch {
      const hasRecentSuccess = _backendAvailableCache?.available &&
        (now - _backendAvailableCache.timestamp) < HEALTH_STALE_TTL_MS;

      if (hasRecentSuccess) {
        return true;
      }

      // Increment failure count for exponential backoff
      const failureCount = (_backendAvailableCache?.failureCount ?? 0) + 1;
      _backendAvailableCache = { available: false, timestamp: now, failureCount };
    }

    return _backendAvailableCache?.available ?? false;
  }

  private async fetch<T>(
    endpoint: string,
    options?: RequestInit & { timeout?: number }
  ): Promise<T> {
    const url = `${this.getBaseUrl()}${endpoint}`;
    const { timeout = 120000, signal: callerSignal, ...fetchOptions } = options || {} as RequestInit & { timeout?: number }; // Default 2 minute timeout

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Forward caller's abort to our controller (avoids AbortSignal.any() for broader browser compat)
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }
    const signal = controller.signal;

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal,
        // Disable browser caching in development to ensure fresh data after code changes
        cache: process.env.NODE_ENV === 'development' ? 'no-store' : 'default',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': getCorrelationId(),
          ...fetchOptions?.headers,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Not found');
        }
        throw new Error(`API error: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Distinguish caller-initiated abort from timeout
        if (callerSignal?.aborted) {
          throw error; // Re-throw original AbortError so callers can detect cancellation
        }
        throw new Error(`Request timed out after ${timeout / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Look up a user by username.
   * Data comes from local database (VNDB dumps include user data).
   */
  async lookupUser(username: string): Promise<UserLookup | null> {
    try {
      return await this.fetch<UserLookup>(`/api/v1/user/lookup?username=${encodeURIComponent(username)}`);
    } catch {
      return null;
    }
  }

  /**
   * Get statistics for a user.
   * ALL data comes from the backend (local PostgreSQL with VNDB dumps).
   *
   * @param uid - VNDB user ID (e.g., "u12345")
   * @param _username - Deprecated parameter, no longer used
   * @param forceRefresh - If true, bypasses all caches and fetches fresh data
   */
  async getUserStats(uid: string, _username?: string, forceRefresh?: boolean): Promise<UserStats> {
    const queryParams = forceRefresh ? '?force_refresh=true' : '';
    // Use 3-minute timeout for stats (large collections can take a while)
    return await this.fetch<UserStats>(`/api/v1/stats/${uid}${queryParams}`, {
      timeout: 180000, // 3 minutes
    });
  }

  async getTagAnalytics(uid: string): Promise<TagAnalytics> {
    return await this.fetch<TagAnalytics>(`/api/v1/stats/${uid}/tags`);
  }

  async getRecommendations(
    uid: string,
    filters: RecommendationFilters = {}
  ): Promise<RecommendationsResponse> {
    const backendUp = await this.checkBackendAvailable();
    const externalSignal = filters.signal;

    const createAbortControllerWithTimeout = (timeoutMs: number, externalSignal?: AbortSignal) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else {
          externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
        }
      }

      return {
        signal: controller.signal,
        cancel: () => clearTimeout(timeoutId),
        abort: () => controller.abort(),
      };
    };

    const fetchBackendRecommendations = async (
      methodOverride?: RecommendationMethod,
      timeoutMs: number = 6000,
      signalOverride?: AbortSignal
    ) => {
      const { signal, cancel } = createAbortControllerWithTimeout(timeoutMs, signalOverride);
      const params = new URLSearchParams();
      params.set('method', methodOverride || filters.method || 'hybrid');
      params.set('limit', String(filters.limit || 20));
      if (filters.lengthFilter) params.set('length_filter', filters.lengthFilter);
      if (filters.spoilerLevel !== undefined) params.set('spoiler_level', String(filters.spoilerLevel));
      if (filters.minRating !== undefined) params.set('min_rating', String(filters.minRating));
      if (filters.skipExplanations) params.set('skip_explanations', 'true');

      const url = `${this.getBaseUrl()}/api/v1/recommendations/${uid}?${params.toString()}`;
      const response = await fetch(url, {
        cache: 'no-store',
        signal,
      });

      cancel();

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      return await response.json();
    };

    const requestedMethod = filters.method || 'hybrid';
    const allowClientFallback = filters.allowClientFallback === true;

    const backendTimeoutMs =
      requestedMethod === 'combined' ? 45000 :
      requestedMethod === 'similar_novels' ? 25000 :
      requestedMethod === 'similar_users' ? 25000 :
      20000;

    if (backendUp) {
      try {
        return await fetchBackendRecommendations(undefined, backendTimeoutMs, externalSignal);
      } catch {
        // For combined, try a lighter backend method before giving up.
        // Don't try fallback if the request was explicitly cancelled (e.g., by component unmount)
        if (requestedMethod === 'combined' && !externalSignal?.aborted) {
          try {
            return await fetchBackendRecommendations('hybrid', 20000, externalSignal);
          } catch {
            // Hybrid fallback also failed
          }
        }
      }
    }

    // If backend failed, return empty recommendations
    return {
      method: requestedMethod,
      recommendations: [],
      excluded_count: 0,
      total_excluded_message: 'Recommendations are temporarily unavailable. Please try again later.',
    };
  }

  async refreshUserData(uid: string): Promise<boolean> {
    try {
      await this.fetch(`/api/v1/user/${uid}/refresh`, { method: 'POST' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get a user's VN list.
   * Data comes from local database (VNDB dumps include user list data).
   */
  async getUserVNList(
    uid: string,
    page: number = 1,
    limit: number = 100
  ): Promise<UserVNListResponse> {
    return await this.fetch<UserVNListResponse>(
      `/api/v1/user/${uid}/list?page=${page}&limit=${limit}`
    );
  }

  /**
   * Get VN details.
   * ALL data comes from local database (VNDB dumps).
   */
  async getVN(vnId: string): Promise<VNDetail | null> {
    try {
      const normalizedId = vnId.startsWith('v') ? vnId : `v${vnId}`;
      return await this.fetch<VNDetail>(`/api/v1/vn/${normalizedId}`);
    } catch {
      return null;
    }
  }

  /**
   * Refresh VN data in the local database.
   */
  async refreshVN(vnId: string): Promise<VNDetail | null> {
    try {
      const normalizedId = vnId.startsWith('v') ? vnId : `v${vnId}`;
      return await this.fetch<VNDetail>(`/api/v1/vn/${normalizedId}/refresh`, {
        method: 'POST',
      });
    } catch {
      return null;
    }
  }

  /**
   * Search for filter entities (tags, traits, staff, seiyuu, developers, publishers).
   * Used by TagFilter for the autocomplete dropdown.
   */
  async searchFilters(query: string, limit: number = 30, signal?: AbortSignal): Promise<{ results: Array<{ id: string; name: string; original: string | null; type: string; category: string | null; count: number }> }> {
    return await this.fetch(
      `/api/v1/vn/search-filters?q=${encodeURIComponent(query)}&limit=${limit}`,
      { signal }
    );
  }

  /**
   * Search for VNs.
   * ALL data comes from local database.
   */
  async searchVNs(query: string, limit: number = 20, signal?: AbortSignal): Promise<VNSearchResponse> {
    return await this.fetch<VNSearchResponse>(
      `/api/v1/vn/search/?q=${encodeURIComponent(query)}&limit=${limit}&nsfw=true&olang=ja`,
      signal ? { signal } : undefined
    );
  }

  /**
   * Browse VNs with comprehensive filtering.
   *
   * Supports text search, alphabetical filtering, tag include/exclude,
   * year/rating ranges, length, age rating, platform, language filters,
   * and various sort options.
   *
   * Backend-only - no VNDB API fallback (too complex for direct API).
   */
  async browseVNs(filters: BrowseFilters = {}, signal?: AbortSignal): Promise<BrowseResponse> {
    const params = new URLSearchParams();

    // Add each filter to params if set
    if (filters.q) params.set('q', filters.q);
    if (filters.first_char) params.set('first_char', filters.first_char);
    if (filters.tags) params.set('tags', filters.tags);
    if (filters.exclude_tags) params.set('exclude_tags', filters.exclude_tags);
    if (filters.traits) params.set('traits', filters.traits);
    if (filters.exclude_traits) params.set('exclude_traits', filters.exclude_traits);
    if (filters.tag_mode) params.set('tag_mode', filters.tag_mode);
    if (filters.include_children !== undefined) params.set('include_children', String(filters.include_children));
    if (filters.year_min !== undefined) params.set('year_min', String(filters.year_min));
    if (filters.year_max !== undefined) params.set('year_max', String(filters.year_max));
    if (filters.min_rating !== undefined) params.set('min_rating', String(filters.min_rating));
    if (filters.max_rating !== undefined) params.set('max_rating', String(filters.max_rating));
    if (filters.min_votecount !== undefined) params.set('min_votecount', String(filters.min_votecount));
    if (filters.max_votecount !== undefined) params.set('max_votecount', String(filters.max_votecount));
    if (filters.length) params.set('length', filters.length);
    if (filters.exclude_length) params.set('exclude_length', filters.exclude_length);
    if (filters.minage) params.set('minage', filters.minage);
    if (filters.exclude_minage) params.set('exclude_minage', filters.exclude_minage);
    if (filters.devstatus !== undefined) params.set('devstatus', String(filters.devstatus));
    if (filters.exclude_devstatus) params.set('exclude_devstatus', filters.exclude_devstatus);
    if (filters.olang) params.set('olang', filters.olang);
    if (filters.exclude_olang) params.set('exclude_olang', filters.exclude_olang);
    if (filters.platform) params.set('platform', filters.platform);
    if (filters.exclude_platform) params.set('exclude_platform', filters.exclude_platform);
    if (filters.spoiler_level !== undefined) params.set('spoiler_level', String(filters.spoiler_level));
    // Entity filters
    if (filters.staff) params.set('staff', filters.staff);
    if (filters.seiyuu) params.set('seiyuu', filters.seiyuu);
    if (filters.developer) params.set('developer', filters.developer);
    if (filters.publisher) params.set('publisher', filters.publisher);
    if (filters.producer) params.set('producer', filters.producer);
    // Always include 18+ content (no NSFW filter in browse page)
    params.set('nsfw', 'true');
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.sort_order) params.set('sort_order', filters.sort_order);
    if (filters.page !== undefined) params.set('page', String(filters.page));
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));

    const url = `/api/v1/vn/search/?${params.toString()}`;

    return await this.fetch<BrowseResponse>(url, {
      cache: 'no-store',
      signal: signal ?? undefined,
      timeout: 30000,
    });
  }

  /**
   * Get top VNs by rating or votecount.
   * ALL data comes from local database.
   */
  async getTopVNs(sort: 'rating' | 'votecount', limit: number = 10): Promise<TopVN[]> {
    try {
      return await this.fetch<TopVN[]>(`/api/v1/vn/top?sort=${sort}&limit=${limit}`);
    } catch {
      return [];
    }
  }

  /**
   * Compare two users.
   * ALL data comes from local database.
   */
  async compareUsers(uid1: string, uid2: string, _username1?: string, _username2?: string): Promise<UserComparisonResponse> {
    return await this.fetch<UserComparisonResponse>(
      `/api/v1/stats/${uid1}/compare/${uid2}`
    );
  }

  /**
   * Get similar users.
   * ALL data comes from local database.
   */
  async getSimilarUsers(uid: string, limit: number = 10): Promise<SimilarUser[]> {
    try {
      return await this.fetch<SimilarUser[]>(
        `/api/v1/stats/${uid}/similar?limit=${limit}`
      );
    } catch {
      return [];
    }
  }

  /**
   * Get similar VNs.
   * ALL data comes from local database.
   */
  async getSimilarVNs(vnId: string, limit: number = 10): Promise<SimilarVNsResponse> {
    const normalizedId = vnId.startsWith('v') ? vnId : `v${vnId}`;
    return await this.fetch<SimilarVNsResponse>(
      `/api/v1/vn/${normalizedId}/similar?limit=${limit}`,
      { timeout: 30000 }
    );
  }

  async getVNCharacters(vnId: string): Promise<VNCharacter[]> {
    // Use backend database dump only
    const normalizedId = vnId.startsWith('v') ? vnId : `v${vnId}`;

    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/vn/${normalizedId}/characters`, {
        method: 'GET',
        next: { revalidate: 300 }, // Cache for 5 minutes
        signal: AbortSignal.timeout(15000), // Increased timeout for reliability
      });

      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Backend failed
    }

    return [];
  }

  async getVNVoteStats(vnId: string): Promise<VNVoteStats | null> {
    const normalizedId = vnId.startsWith('v') ? vnId : `v${vnId}`;
    try {
      return await this.fetch<VNVoteStats>(
        `/api/v1/vn/${normalizedId}/vote-stats`,
        { timeout: 15000 }
      );
    } catch {
      return null;
    }
  }

  async getCharacter(charId: string): Promise<CharacterDetail | null> {
    // Use backend database dump only
    const normalizedId = charId.startsWith('c') ? charId : `c${charId}`;

    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/characters/${normalizedId}`, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Backend failed
    }

    return null;
  }

  async getSimilarCharacters(charId: string, limit: number = 10): Promise<SimilarCharacter[]> {
    // Backend-only - no VNDB API equivalent exists
    const normalizedId = charId.startsWith('c') ? charId : `c${charId}`;

    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/characters/${normalizedId}/similar?limit=${limit}`, {
        method: 'GET',
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Backend failed
    }

    // No VNDB API fallback available for similar characters
    return [];
  }

  /**
   * Get global character counts for traits (for IDF importance calculation).
   */
  async getTraitCounts(traitIds: string[]): Promise<{ counts: Record<string, number>; total_characters: number }> {
    if (traitIds.length === 0) {
      return { counts: {}, total_characters: 0 };
    }

    try {
      const ids = traitIds.join(',');
      const response = await fetch(`${this.getBaseUrl()}/api/v1/vn/traits/counts?ids=${encodeURIComponent(ids)}`, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return { counts: {}, total_characters: 0 };
      }

      return await response.json();
    } catch {
      return { counts: {}, total_characters: 0 };
    }
  }

  /**
   * Check if running in fallback mode.
   *
   * DEPRECATED: This method always returns false now.
   * There is no fallback mode - all data comes from the local database.
   * Kept for backwards compatibility with existing UI code.
   */
  async isUsingFallback(): Promise<boolean> {
    // Always return false - we no longer have a fallback mode.
    // All data comes from local database (VNDB dumps).
    return false;
  }

  /**
   * Reset cached state (for HMR in development).
   * This ensures fresh health checks after code changes.
   */
  resetCache(): void {
    _backendAvailableCache = null;
  }

  // Get database status including last update time
  async getDataStatus(): Promise<DataStatus | null> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/health/db`, {
        method: 'GET',
        cache: process.env.NODE_ENV === 'development' ? 'no-store' : 'default',
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        return response.json();
      }
    } catch {
      // Backend not available
    }
    return null;
  }

  // Get global database statistics
  async getGlobalStats(options?: { nocache?: boolean }): Promise<GlobalStats | null> {
    const backendUp = await this.checkBackendAvailable();

    if (backendUp) {
      try {
        const queryParams = options?.nocache ? '?nocache=true' : '';
        return await this.fetch<GlobalStats>(`/api/v1/stats/global${queryParams}`);
      } catch {
        // Backend doesn't have global stats endpoint
      }
    }

    // No fallback for global stats - requires backend
    return null;
  }

  // ============ Tag Detail Methods ============
  // ALL data comes from local database (VNDB dumps).

  /**
   * Get tag details.
   * ALL data comes from local database.
   * Uses the stats endpoint which includes tag info.
   */
  async getTag(tagId: string): Promise<TagDetail | null> {
    try {
      // Stats endpoint returns { tag: {...}, average_rating: ..., ... }
      // We extract just the tag info
      const response = await this.fetch<{
        tag: { id: string; name: string; description?: string; category?: string; vn_count: number; aliases?: string[] };
      }>(`/api/v1/stats/tag/${tagId}`);
      return response.tag;
    } catch {
      return null;
    }
  }

  /**
   * Batch fetch multiple tags by ID.
   * ALL data comes from local database.
   * Uses in-memory cache to avoid redundant fetches for the same tags.
   */
  async getTags(tagIds: string[]): Promise<Map<string, TagDetail>> {
    const map = new Map<string, TagDetail>();
    if (tagIds.length === 0) return map;

    // Check cache first, collect IDs that need fetching
    const uncachedIds: string[] = [];
    for (const id of tagIds) {
      const cached = getCachedTag(id);
      if (cached) {
        map.set(id, cached);
      } else {
        uncachedIds.push(id);
      }
    }

    // Only fetch uncached tags
    if (uncachedIds.length > 0) {
      const results = await Promise.allSettled(
        uncachedIds.map(id => this.getTag(id))
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled' && result.value) {
          const tagId = uncachedIds[i];
          map.set(tagId, result.value);
          setCachedTag(tagId, result.value);
        }
      }
    }

    return map;
  }

  async getTagVNs(
    tagId: string,
    page: number = 1,
    limit: number = 24,
    sort: 'rating' | 'votecount' | 'released' = 'rating',
    spoilerLevel: number = 0,
    olang?: string
  ): Promise<TagVNsResponse | null> {
    const backendUp = await this.checkBackendAvailable();

    if (backendUp) {
      try {
        // Backend returns VNs with full tag data (vn_count, spoiler) for IDF weighting
        const response = await this.fetch<{
          tag: { id: string; name: string; description?: string; category?: string; vn_count: number; aliases?: string[] };
          vns: Array<{
            id: string;
            title: string;
            title_jp?: string;
            title_romaji?: string;
            image_url?: string;
            image_sexual?: number;
            released?: string;
            rating?: number;
            votecount: number;
            olang?: string;
            tags: Array<{ id: string; name: string; category?: string; score: number; spoiler: number; vn_count: number }>;
          }>;
          total: number;
          page: number;
          pages: number;
        }>(`/api/v1/stats/tag/${tagId}/vns-with-tags?page=${page}&limit=${limit}&sort=${sort}&spoiler_level=${spoilerLevel}${olang ? `&olang=${olang}` : ''}`);

        return {
          tag: {
            id: response.tag.id,
            name: response.tag.name,
            description: response.tag.description,
            category: response.tag.category,
            vn_count: response.tag.vn_count,
            aliases: response.tag.aliases,
          },
          vns: response.vns.map(vn => ({
            id: vn.id,
            title: vn.title,
            alttitle: vn.title_jp,
            title_romaji: vn.title_romaji,
            image_url: vn.image_url,
            image_sexual: vn.image_sexual,
            released: vn.released,
            rating: vn.rating,
            votecount: vn.votecount,
            olang: vn.olang,
            tags: vn.tags.map(t => ({
              id: t.id,
              name: t.name,
              rating: t.score,
              vn_count: t.vn_count,
              spoiler: t.spoiler,
            })),
          })),
          total: response.total,
          page: response.page,
          pages: response.pages,
          more: response.page < response.pages,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Get statistics for a tag.
   * ALL data comes from local database.
   */
  async getTagStats(tagId: string, options?: { nocache?: boolean }): Promise<TagStatsData | null> {
    const nocache = options?.nocache ? '?nocache=1' : '';

    try {
      // Backend returns TagStatsResponse with nested tag info
      const response = await this.fetch<{
        tag: { id: string; name: string; description?: string; category?: string; vn_count: number };
        average_rating: number;
        total_votes: number;
        total_vns: number;
        score_distribution: Record<string, number>;
        score_distribution_jp?: Record<string, number>;
        release_year_distribution: Record<string, number>;
        release_year_with_ratings?: YearWithRating[];
        length_distribution: Record<string, CategoryStats>;
        age_rating_distribution: Record<string, CategoryStats>;
        last_updated?: string;
      }>(`/api/v1/stats/tag/${tagId}${nocache}`);

      // Transform to frontend TagStatsData format
      return {
        score_distribution: response.score_distribution,
        score_distribution_jp: response.score_distribution_jp,
        release_year_distribution: response.release_year_distribution,
        release_year_with_ratings: response.release_year_with_ratings,
        length_distribution: response.length_distribution,
        age_rating_distribution: response.age_rating_distribution,
        average_rating: response.average_rating,
        total_votes: response.total_votes,
        total_users: response.total_vns, // Map total_vns to total_users
        last_updated: response.last_updated,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get similar tags.
   * ALL data comes from local database.
   */
  async getSimilarTags(tagId: string, limit: number = 20): Promise<SimilarTag[]> {
    try {
      const id = tagId.startsWith('g') ? tagId.substring(1) : tagId;
      return await this.fetch<SimilarTag[]>(
        `/api/v1/stats/tag/${id}/similar?limit=${limit}`
      );
    } catch {
      return [];
    }
  }

  async getTagTraits(tagId: string, limit: number = 20): Promise<SimilarTrait[]> {
    // Try backend first (uses NPMI algorithm for better results)
    const backendUp = await this.checkBackendAvailable();
    if (backendUp) {
      try {
        const id = tagId.startsWith('g') ? tagId.substring(1) : tagId;
        const response = await this.fetch<SimilarTrait[]>(
          `/api/v1/stats/tag/${id}/traits?limit=${limit}`
        );
        return response;
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Get tag parents.
   * ALL data comes from local database.
   */
  async getTagParents(tagId: string): Promise<TagParent[]> {
    try {
      const id = tagId.startsWith('g') ? tagId.substring(1) : tagId;
      return await this.fetch<TagParent[]>(`/api/v1/stats/tag/${id}/parents`);
    } catch {
      return [];
    }
  }

  /**
   * Get tag children.
   * ALL data comes from local database.
   */
  async getTagChildren(tagId: string): Promise<TagChild[]> {
    try {
      const id = tagId.startsWith('g') ? tagId.substring(1) : tagId;
      return await this.fetch<TagChild[]>(`/api/v1/stats/tag/${id}/children`);
    } catch {
      return [];
    }
  }

  // ============ Trait Detail Methods ============
  // ALL data comes from local database (VNDB dumps).

  /**
   * Get trait details.
   * ALL data comes from local database.
   */
  async getTrait(traitId: string): Promise<TraitDetail | null> {
    try {
      // Stats endpoint returns { trait: {...}, ... }
      // We extract just the trait info
      const id = traitId.startsWith('i') ? traitId.substring(1) : traitId;
      const response = await this.fetch<{
        trait: { id: string; name: string; description?: string; group_id?: string; group_name?: string; char_count?: number };
      }>(`/api/v1/stats/trait/${id}`);
      return response.trait;
    } catch {
      return null;
    }
  }

  /**
   * Batch fetch multiple traits by ID.
   * ALL data comes from local database.
   * Uses in-memory cache to avoid redundant fetches for the same traits.
   */
  async getTraits(traitIds: string[]): Promise<Map<string, TraitDetail>> {
    const map = new Map<string, TraitDetail>();
    if (traitIds.length === 0) return map;

    // Check cache first, collect IDs that need fetching
    const uncachedIds: string[] = [];
    for (const id of traitIds) {
      const cached = getCachedTrait(id);
      if (cached) {
        map.set(id, cached);
      } else {
        uncachedIds.push(id);
      }
    }

    // Only fetch uncached traits
    if (uncachedIds.length > 0) {
      const results = await Promise.allSettled(
        uncachedIds.map(id => this.getTrait(id))
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled' && result.value) {
          const traitId = uncachedIds[i];
          map.set(traitId, result.value);
          setCachedTrait(traitId, result.value);
        }
      }
    }

    return map;
  }

  /**
   * Get characters with a specific trait.
   * ALL data comes from local database.
   */
  async getTraitCharacters(
    traitId: string,
    page: number = 1,
    limit: number = 24,
    olang?: string
  ): Promise<TraitCharactersResponse | null> {
    try {
      const id = traitId.startsWith('i') ? traitId.substring(1) : traitId;
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (olang) params.append('olang', olang);

      return await this.fetch<TraitCharactersResponse>(
        `/api/v1/stats/trait/${id}/characters?${params.toString()}`
      );
    } catch {
      return null;
    }
  }

  /**
   * Get VNs with characters having a specific trait.
   * ALL data comes from local database.
   */
  async getTraitVNs(traitId: string, limit: number = 50): Promise<TagVN[]> {
    try {
      const id = traitId.startsWith('i') ? traitId.substring(1) : traitId;
      return await this.fetch<TagVN[]>(`/api/v1/trait/${id}/vns?limit=${limit}`);
    } catch {
      return [];
    }
  }

  /**
   * Get trait parents.
   * ALL data comes from local database.
   */
  async getTraitParents(traitId: string): Promise<TraitParent[]> {
    try {
      const id = traitId.startsWith('i') ? traitId.substring(1) : traitId;
      return await this.fetch<TraitParent[]>(`/api/v1/stats/trait/${id}/parents`);
    } catch {
      return [];
    }
  }

  /**
   * Get trait children.
   * ALL data comes from local database.
   */
  async getTraitChildren(traitId: string): Promise<TraitChild[]> {
    try {
      const id = traitId.startsWith('i') ? traitId.substring(1) : traitId;
      return await this.fetch<TraitChild[]>(`/api/v1/stats/trait/${id}/children`);
    } catch {
      return [];
    }
  }

  async getTraitVNsWithTags(
    traitId: string,
    page: number = 1,
    limit: number = 24,
    sort: 'rating' | 'votecount' | 'released' = 'rating',
    spoilerLevel: number = 0,
    olang?: string
  ): Promise<TraitVNsWithTagsResponse | null> {
    const backendUp = await this.checkBackendAvailable();
    const id = traitId.startsWith('i') ? traitId.substring(1) : traitId;

    if (backendUp) {
      try {
        const response = await this.fetch<{
          vns: Array<{
            id: string;
            title: string;
            title_jp?: string;
            title_romaji?: string;
            image_url?: string;
            image_sexual?: number;
            released?: string;
            rating?: number;
            votecount: number;
            olang?: string;
            tags: Array<{ id: string; name: string; category?: string; score: number; spoiler: number; vn_count: number }>;
          }>;
          total: number;
          page: number;
          pages: number;
        }>(`/api/v1/stats/trait/${id}/vns-with-tags?page=${page}&limit=${limit}&sort=${sort}&spoiler_level=${spoilerLevel}${olang ? `&olang=${olang}` : ''}`);

        return {
          vns: response.vns.map(vn => ({
            id: vn.id,
            title: vn.title,
            alttitle: vn.title_jp,
            title_romaji: vn.title_romaji,
            image_url: vn.image_url,
            image_sexual: vn.image_sexual,
            released: vn.released,
            rating: vn.rating,
            votecount: vn.votecount,
            olang: vn.olang,
            tags: vn.tags.map(t => ({
              id: t.id,
              name: t.name,
              rating: t.score,
              vn_count: t.vn_count,
              spoiler: t.spoiler,
            })),
          })),
          total: response.total,
          page: response.page,
          pages: response.pages,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Get trait statistics.
   * ALL data comes from local database.
   */
  async getTraitStats(traitId: string, options?: { nocache?: boolean }): Promise<TraitStatsData | null> {
    const nocache = options?.nocache ? '?nocache=true' : '';
    const id = traitId.startsWith('i') ? traitId.substring(1) : traitId;

    try {
      // Backend returns TraitStatsResponse with nested trait info
      const response = await this.fetch<{
        trait: { id: string; name: string; description?: string; group_id?: number; group_name?: string; char_count: number };
        average_rating: number;
        total_votes: number;
        total_vns: number;
        score_distribution: Record<string, number>;
        score_distribution_jp?: Record<string, number>;
        release_year_distribution: Record<string, number>;
        release_year_with_ratings?: YearWithRating[];
        length_distribution: Record<string, CategoryStats>;
        age_rating_distribution: Record<string, CategoryStats>;
        last_updated?: string;
      }>(`/api/v1/stats/trait/${id}${nocache}`);

      // Transform to frontend TraitStatsData format
      return {
        score_distribution: response.score_distribution,
        score_distribution_jp: response.score_distribution_jp,
        release_year_distribution: response.release_year_distribution,
        release_year_with_ratings: response.release_year_with_ratings,
        length_distribution: response.length_distribution,
        age_rating_distribution: response.age_rating_distribution,
        average_rating: response.average_rating,
        total_vns: response.total_vns,
        total_characters: response.trait.char_count,
        last_updated: response.last_updated,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get similar traits.
   * ALL data comes from local database.
   */
  async getSimilarTraits(traitId: string, limit: number = 20): Promise<SimilarTraitResult[]> {
    try {
      const id = traitId.startsWith('i') ? traitId.substring(1) : traitId;
      return await this.fetch<SimilarTraitResult[]>(
        `/api/v1/stats/trait/${id}/similar?limit=${limit}`
      );
    } catch {
      return [];
    }
  }

  /**
   * Get related tags for a trait.
   * ALL data comes from local database.
   */
  async getTraitTags(traitId: string, limit: number = 20): Promise<RelatedTag[]> {
    try {
      const id = traitId.startsWith('i') ? traitId.substring(1) : traitId;
      return await this.fetch<RelatedTag[]>(
        `/api/v1/stats/trait/${id}/tags?limit=${limit}`
      );
    } catch {
      return [];
    }
  }

  // ============ Producer Detail Methods ============
  // ALL data comes from local database (VNDB dumps).

  /**
   * Get statistics for a producer/developer.
   * ALL data comes from local database.
   */
  async getProducerStats(producerId: string, options?: { nocache?: boolean }): Promise<ProducerStatsData | null> {
    const nocache = options?.nocache ? '?nocache=1' : '';

    try {
      return await this.fetch<ProducerStatsData>(`/api/v1/stats/producer/${producerId}${nocache}`);
    } catch {
      return null;
    }
  }

  /**
   * Get paginated list of VNs by a producer.
   * Only available when backend is running.
   */
  async getProducerVNs(
    producerId: string,
    page: number = 1,
    limit: number = 24,
    sort: 'rating' | 'released' | 'votecount' = 'rating'
  ): Promise<ProducerVNsResponse | null> {
    const backendUp = await this.checkBackendAvailable();

    if (!backendUp) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sort,
      });

      return await this.fetch<ProducerVNsResponse>(
        `/api/v1/stats/producer/${producerId}/vns?${params.toString()}`
      );
    } catch {
      return null;
    }
  }

  /**
   * Get paginated list of VNs by a producer with full tag data.
   * Only available when backend is running.
   */
  async getProducerVNsWithTags(
    producerId: string,
    page: number = 1,
    limit: number = 24,
    sort: 'rating' | 'released' | 'votecount' = 'rating',
    spoilerLevel: number = 0,
    olang?: string
  ): Promise<ProducerVNsWithTagsResponse | null> {
    const backendUp = await this.checkBackendAvailable();

    if (!backendUp) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sort,
        spoiler_level: spoilerLevel.toString(),
      });
      if (olang) params.append('olang', olang);

      return await this.fetch<ProducerVNsWithTagsResponse>(
        `/api/v1/stats/producer/${producerId}/vns-with-tags?${params.toString()}`
      );
    } catch {
      return null;
    }
  }

  /**
   * Get similar producers based on staff overlap.
   * Only available when backend is running.
   */
  async getSimilarProducers(producerId: string, limit: number = 10): Promise<SimilarProducerResult[]> {
    const backendUp = await this.checkBackendAvailable();

    if (!backendUp) {
      return [];
    }

    try {
      return await this.fetch<SimilarProducerResult[]>(
        `/api/v1/stats/producer/${producerId}/similar?limit=${limit}`
      );
    } catch {
      return [];
    }
  }

  // ============ Staff Stats Methods ============

  /**
   * Get statistics for a staff member.
   * Only available when backend is running.
   */
  async getStaffStats(staffId: string, options?: { nocache?: boolean }): Promise<StaffStatsData | null> {
    const backendUp = await this.checkBackendAvailable();
    const nocache = options?.nocache ? '?nocache=1' : '';

    if (!backendUp) {
      return null;
    }

    try {
      return await this.fetch<StaffStatsData>(`/api/v1/stats/staff/${staffId}${nocache}`);
    } catch {
      return null;
    }
  }

  /**
   * Get paginated list of VNs a staff member worked on.
   * Only available when backend is running.
   */
  async getStaffVNs(
    staffId: string,
    page: number = 1,
    limit: number = 24,
    sort: 'rating' | 'released' | 'votecount' = 'rating'
  ): Promise<StaffVNsResponse | null> {
    const backendUp = await this.checkBackendAvailable();

    if (!backendUp) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sort,
      });

      return await this.fetch<StaffVNsResponse>(
        `/api/v1/stats/staff/${staffId}/vns?${params.toString()}`
      );
    } catch {
      return null;
    }
  }

  /**
   * Get paginated list of VNs a staff member worked on with full tag data.
   * Only available when backend is running.
   */
  async getStaffVNsWithTags(
    staffId: string,
    page: number = 1,
    limit: number = 24,
    sort: 'rating' | 'released' | 'votecount' = 'rating',
    spoilerLevel: number = 0,
    olang?: string
  ): Promise<StaffVNsWithTagsResponse | null> {
    const backendUp = await this.checkBackendAvailable();

    if (!backendUp) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sort,
        spoiler_level: spoilerLevel.toString(),
      });
      if (olang) params.append('olang', olang);

      return await this.fetch<StaffVNsWithTagsResponse>(
        `/api/v1/stats/staff/${staffId}/vns-with-tags?${params.toString()}`
      );
    } catch {
      return null;
    }
  }

  // ============ Seiyuu Stats Methods ============

  /**
   * Get statistics for a voice actor (seiyuu).
   * Only available when backend is running.
   */
  async getSeiyuuStats(staffId: string, options?: { nocache?: boolean }): Promise<SeiyuuStatsData | null> {
    const backendUp = await this.checkBackendAvailable();
    const nocache = options?.nocache ? '?nocache=1' : '';

    if (!backendUp) {
      return null;
    }

    try {
      return await this.fetch<SeiyuuStatsData>(`/api/v1/stats/seiyuu/${staffId}${nocache}`);
    } catch {
      return null;
    }
  }

  /**
   * Get paginated list of VNs a voice actor appeared in.
   * Only available when backend is running.
   */
  async getSeiyuuVNs(
    staffId: string,
    page: number = 1,
    limit: number = 24,
    sort: 'rating' | 'released' | 'votecount' = 'rating'
  ): Promise<SeiyuuVNsResponse | null> {
    const backendUp = await this.checkBackendAvailable();

    if (!backendUp) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sort,
      });

      return await this.fetch<SeiyuuVNsResponse>(
        `/api/v1/stats/seiyuu/${staffId}/vns?${params.toString()}`
      );
    } catch {
      return null;
    }
  }

  /**
   * Get paginated list of VNs a voice actor appeared in with full tag data.
   * Only available when backend is running.
   */
  async getSeiyuuVNsWithTags(
    staffId: string,
    page: number = 1,
    limit: number = 24,
    sort: 'rating' | 'released' | 'votecount' = 'rating',
    spoilerLevel: number = 0,
    olang?: string
  ): Promise<SeiyuuVNsWithTagsResponse | null> {
    const backendUp = await this.checkBackendAvailable();

    if (!backendUp) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sort,
        spoiler_level: spoilerLevel.toString(),
      });
      if (olang) params.append('olang', olang);

      return await this.fetch<SeiyuuVNsWithTagsResponse>(
        `/api/v1/stats/seiyuu/${staffId}/vns-with-tags?${params.toString()}`
      );
    } catch {
      return null;
    }
  }

  /**
   * Get paginated list of characters voiced by a seiyuu.
   * Only available when backend is running.
   */
  async getSeiyuuCharacters(
    staffId: string,
    page: number = 1,
    limit: number = 24,
    sort: 'name' | 'vn_count' = 'name'
  ): Promise<SeiyuuCharactersResponse | null> {
    const backendUp = await this.checkBackendAvailable();

    if (!backendUp) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sort,
      });

      return await this.fetch<SeiyuuCharactersResponse>(
        `/api/v1/stats/seiyuu/${staffId}/characters?${params.toString()}`
      );
    } catch {
      return null;
    }
  }

  // ============ VN List by Category Methods ============

  /**
   * Get VNs with a specific tag filtered by category.
   * Only available when backend is running.
   */
  async getTagVNsByCategory(
    tagId: string,
    categoryType: CategoryType,
    categoryValue: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<VNListByCategoryResponse | null> {
    const backendUp = await this.checkBackendAvailable();

    if (!backendUp) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        category_type: categoryType,
        category_value: categoryValue,
        limit: limit.toString(),
        offset: offset.toString(),
      });

      return await this.fetch<VNListByCategoryResponse>(
        `/api/v1/stats/tag/${tagId}/vns-by-category?${params.toString()}`
      );
    } catch {
      return null;
    }
  }

  /**
   * Get VNs with characters having a specific trait, filtered by category.
   * Only available when backend is running.
   */
  async getTraitVNsByCategory(
    traitId: string,
    categoryType: CategoryType,
    categoryValue: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<VNListByCategoryResponse | null> {
    const backendUp = await this.checkBackendAvailable();

    if (!backendUp) {
      return null;
    }

    const id = traitId.startsWith('i') ? traitId.substring(1) : traitId;
    try {
      const params = new URLSearchParams({
        category_type: categoryType,
        category_value: categoryValue,
        limit: limit.toString(),
        offset: offset.toString(),
      });

      return await this.fetch<VNListByCategoryResponse>(
        `/api/v1/stats/trait/${id}/vns-by-category?${params.toString()}`
      );
    } catch {
      return null;
    }
  }

  // ============ Browse Entity Methods ============

  private buildBrowseParams(params: BrowseEntityParams): URLSearchParams {
    const searchParams = new URLSearchParams();
    if (params.q) searchParams.set('q', params.q);
    if (params.first_char) searchParams.set('first_char', params.first_char);
    if (params.sort) searchParams.set('sort', params.sort);
    if (params.sort_order) searchParams.set('sort_order', params.sort_order);
    if (params.page !== undefined) searchParams.set('page', String(params.page));
    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
    return searchParams;
  }

  async browseTags(params: BrowseTagParams = {}): Promise<BrowseTagsResponse> {
    const searchParams = this.buildBrowseParams(params);
    if (params.category) searchParams.set('category', params.category);

    try {
      return await this.fetch<BrowseTagsResponse>(
        `/api/v1/browse/tags?${searchParams.toString()}`,
        { signal: AbortSignal.timeout(15000) }
      );
    } catch {
      return { items: [], total: 0, page: 1, pages: 1 };
    }
  }

  async browseTraits(params: BrowseTraitParams = {}): Promise<BrowseTraitsResponse> {
    const searchParams = this.buildBrowseParams(params);
    if (params.group_name) searchParams.set('group_name', params.group_name);

    try {
      return await this.fetch<BrowseTraitsResponse>(
        `/api/v1/browse/traits?${searchParams.toString()}`,
        { signal: AbortSignal.timeout(15000) }
      );
    } catch {
      return { items: [], total: 0, page: 1, pages: 1 };
    }
  }

  async browseStaff(params: BrowseStaffParams = {}): Promise<BrowseStaffResponse> {
    const searchParams = this.buildBrowseParams(params);
    if (params.role) searchParams.set('role', params.role);
    if (params.lang) searchParams.set('lang', params.lang);
    if (params.gender) searchParams.set('gender', params.gender);

    try {
      return await this.fetch<BrowseStaffResponse>(
        `/api/v1/browse/staff?${searchParams.toString()}`,
        { signal: AbortSignal.timeout(15000) }
      );
    } catch {
      return { items: [], total: 0, page: 1, pages: 1 };
    }
  }

  async browseSeiyuu(params: BrowseSeiyuuParams = {}): Promise<BrowseSeiyuuResponse> {
    const searchParams = this.buildBrowseParams(params);
    if (params.lang) searchParams.set('lang', params.lang);
    if (params.gender) searchParams.set('gender', params.gender);

    try {
      return await this.fetch<BrowseSeiyuuResponse>(
        `/api/v1/browse/seiyuu?${searchParams.toString()}`,
        { signal: AbortSignal.timeout(15000) }
      );
    } catch {
      return { items: [], total: 0, page: 1, pages: 1 };
    }
  }

  async browseDevelopers(params: BrowseProducerParams = {}): Promise<BrowseProducersResponse> {
    const searchParams = this.buildBrowseParams(params);
    if (params.type) searchParams.set('type', params.type);
    if (params.lang) searchParams.set('lang', params.lang);

    try {
      return await this.fetch<BrowseProducersResponse>(
        `/api/v1/browse/developers?${searchParams.toString()}`,
        { signal: AbortSignal.timeout(15000) }
      );
    } catch {
      return { items: [], total: 0, page: 1, pages: 1 };
    }
  }

  async browsePublishers(params: BrowseProducerParams = {}): Promise<BrowseProducersResponse> {
    const searchParams = this.buildBrowseParams(params);
    if (params.type) searchParams.set('type', params.type);
    if (params.lang) searchParams.set('lang', params.lang);

    try {
      return await this.fetch<BrowseProducersResponse>(
        `/api/v1/browse/publishers?${searchParams.toString()}`,
        { signal: AbortSignal.timeout(15000) }
      );
    } catch {
      return { items: [], total: 0, page: 1, pages: 1 };
    }
  }

  async browseProducers(params: BrowseProducerParams = {}): Promise<BrowseProducersResponse> {
    const searchParams = this.buildBrowseParams(params);
    if (params.type) searchParams.set('type', params.type);
    if (params.lang) searchParams.set('lang', params.lang);
    if (params.role) searchParams.set('role', params.role);

    try {
      return await this.fetch<BrowseProducersResponse>(
        `/api/v1/browse/producers?${searchParams.toString()}`,
        { signal: AbortSignal.timeout(15000) }
      );
    } catch {
      return { items: [], total: 0, page: 1, pages: 1 };
    }
  }

  async getRandomVN(): Promise<string | null> {
    try {
      const result = await this.fetch<{ id: string | null }>('/api/v1/vn/random/', { signal: AbortSignal.timeout(10000) });
      return result.id;
    } catch {
      return null;
    }
  }

  async getRandomEntity(entityType: 'tags' | 'traits' | 'staff' | 'seiyuu' | 'producers'): Promise<string | null> {
    try {
      const result = await this.fetch<{ id: string | null }>(`/api/v1/browse/random/${entityType}`, { signal: AbortSignal.timeout(10000) });
      return result.id;
    } catch {
      return null;
    }
  }
}

// Singleton instance
export const vndbStatsApi = new VNDBStatsAPI();

// Backend health check is cached for 30 seconds to avoid redundant checks.

// Utility functions
export function formatScore(score: number): string {
  return score.toFixed(1);
}

export function formatHours(hours: number): string {
  return `${hours.toLocaleString()}h`;
}

export function getVNDBUrl(vnId: string): string {
  if (!/^v\d+$/.test(vnId)) return 'https://vndb.org/';
  return `https://vndb.org/${vnId}`;
}

export function getVNDBUserUrl(uid: string): string {
  if (!/^u\d+$/.test(uid)) return 'https://vndb.org/';
  return `https://vndb.org/${uid}`;
}
