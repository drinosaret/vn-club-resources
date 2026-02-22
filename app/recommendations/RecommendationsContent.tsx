'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Sparkles, Search, Star, ChevronDown, ChevronUp, X, TrendingUp, Users, BookOpen, Info } from 'lucide-react';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import { getBackendUrl } from '@/lib/config';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { CARD_IMAGE_WIDTH, CARD_IMAGE_SIZES, buildCardSrcSet } from '@/components/vn/card-image-utils';
import { useTitlePreference, getDisplayTitle, TitlePreference } from '@/lib/title-preference';
import { HowItWorksAccordion } from '@/components/recommendations/HowItWorksAccordion';
import TagTraitAutocomplete, { SelectedItem } from '@/components/recommendations/TagTraitAutocomplete';
import { CompactRecommendationFilters } from '@/components/recommendations/CompactRecommendationFilters';
import { useImageFade } from '@/hooks/useImageFade';
import { NSFWImage } from '@/components/NSFWImage';
import { FadeIn } from '@/components/FadeIn';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Lazy load the modal component to reduce initial bundle size
const RecommendationDetailModal = dynamic(
  () => import('@/components/recommendations/RecommendationDetailModal').then(mod => ({ default: mod.RecommendationDetailModal })),
  { ssr: false }
);

interface RecommendationDetails {
  matched_tags: Array<{ id: number; name: string; user_weight: number; vn_score: number; contribution: number; weighted_score: number; count: number }>;
  matched_staff: Array<{ id: string; name: string; user_avg_rating: number; weight: number; weighted_score: number; count: number }>;
  matched_developers: Array<{ name: string; user_avg_rating: number; weight: number; weighted_score: number; count: number }>;
  matched_seiyuu?: Array<{ id: string; name: string; weighted_score: number; count: number }>;
  matched_traits?: Array<{ id: number; name: string; weighted_score: number; count: number }>;
  contributing_vns: Array<{ id: string; title: string; similarity: number }>;
  similar_games: Array<{ source_vn_id: string; source_title?: string; similarity: number }>;
  users_also_read: Array<{ source_vn_id: string; source_title?: string; co_score: number; user_count: number }>;
}

interface Recommendation {
  vn_id: string;
  title: string;
  title_jp?: string;       // Original Japanese title (kanji/kana)
  title_romaji?: string;   // Romanized title
  score: number;
  normalized_score?: number;  // 0-100 scale from backend
  match_reasons: string[];
  image_url: string | null;
  image_sexual: number | null;  // For NSFW blur (0=safe, 1=suggestive, 2=explicit)
  rating: number | null;
  scores: {
    tag: number;
    similar_games: number;
    users_also_read: number;
    developer?: number;
    staff: number;
    seiyuu?: number;
    trait?: number;
    quality?: number;
  };
  details?: RecommendationDetails;  // Optional - fetched on-demand
}

interface RecommendationsResponse {
  recommendations: Recommendation[];
  count: number;
  excluded_count: number;
  elapsed_seconds: number;
}


interface RecommendationCardProps {
  rec: Recommendation;
  index: number;
  titlePreference: TitlePreference;
  onInfoClick: (rec: Recommendation) => void;
}

function RecommendationCard({ rec, index, titlePreference, onInfoClick }: RecommendationCardProps) {
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  const imageUrl = getProxiedImageUrl(rec.image_url, { width: CARD_IMAGE_WIDTH, vnId: rec.vn_id });
  const srcSet = rec.image_url ? buildCardSrcSet(rec.image_url, rec.vn_id) : undefined;

  return (
    <div
      className="group relative bg-gray-50 dark:bg-gray-800/50 rounded-lg overflow-hidden hover:ring-2 hover:ring-violet-500 transition-[box-shadow,ring-color] duration-150 border border-gray-100 dark:border-gray-700"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 280px' }}
    >
      <Link
        href={`/vn/${rec.vn_id.replace('v', '')}`}
        className="block"
      >
        {/* Image */}
        <div className="relative aspect-3/4">
          {/* Shimmer placeholder - visible until image loads */}
          <div className={shimmerClass} />
          {rec.image_url ? (
            <NSFWImage
              src={imageUrl || rec.image_url}
              alt={rec.title}
              imageSexual={rec.image_sexual}
              className={`w-full h-full object-cover ${fadeClass}`}
              loading="lazy"
              srcSet={srcSet}
              sizes={CARD_IMAGE_SIZES}
              onLoad={onLoad}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 bg-gray-200 dark:bg-gray-700">
              <BookOpen className="w-8 h-8" />
            </div>
          )}
          {/* Rank Badge */}
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/70 text-white text-xs font-bold rounded-sm">
            #{index + 1}
          </div>
          {/* Rating Badge */}
          {rec.rating && (
            <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/70 text-white text-xs rounded-sm">
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
              {rec.rating.toFixed(1)}
            </div>
          )}
          {/* Match Score Badge */}
          <div className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-violet-600/90 text-white text-xs font-bold rounded-sm">
            <Sparkles className="w-3 h-3" />
            {rec.normalized_score ?? Math.min(100, Math.round(rec.score * 18))}%
          </div>
        </div>

        {/* Content */}
        <div className="p-2">
          <h4 className="font-medium text-xs text-gray-900 dark:text-white line-clamp-2 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors" title={getDisplayTitle({ title: rec.title, title_jp: rec.title_jp, title_romaji: rec.title_romaji }, titlePreference)}>
            {getDisplayTitle({ title: rec.title, title_jp: rec.title_jp, title_romaji: rec.title_romaji }, titlePreference)}
          </h4>
        </div>
      </Link>

      {/* Info button - appears on hover */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onInfoClick(rec);
        }}
        className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100 transition-opacity flex items-center justify-center hover:bg-violet-600 z-10"
        title="Why this recommendation?"
      >
        <Info className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function RecommendationsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { preference: titlePreference } = useTitlePreference();

  // User state
  const [userId, setUserId] = useState('');
  const [username, setUsername] = useState('');
  const [isLoadingUser, setIsLoadingUser] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  // Recommendations state
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number | null>(null);
  const [frontendTime, setFrontendTime] = useState<number | null>(null);
  const [loadingElapsed, setLoadingElapsed] = useState(0);
  const loadingStartRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filter state
  const [minRating, setMinRating] = useState<string>('');
  const [lengthFilters, setLengthFilters] = useState<string[]>([]);
  const [japaneseOnly, setJapaneseOnly] = useState(true);
  const [spoilerLevel, setSpoilerLevel] = useState(0);
  const [tagTraitFilters, setTagTraitFilters] = useState<SelectedItem[]>([]);

  // How it works dropdown state
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  // Track last processed search params to avoid duplicate fetches
  const lastProcessedParams = useRef<string>('');

  // Clean up retry timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  // Track elapsed time during loading
  useEffect(() => {
    if (isLoading) {
      loadingStartRef.current = Date.now();
      setLoadingElapsed(0);

      const interval = setInterval(() => {
        if (loadingStartRef.current) {
          setLoadingElapsed(Math.floor((Date.now() - loadingStartRef.current) / 1000));
        }
      }, 1000);

      return () => clearInterval(interval);
    } else {
      loadingStartRef.current = null;
    }
  }, [isLoading]);

  // Modal state
  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // Fetch details for a specific recommendation (with timeout)
  const fetchDetailsForVn = async (rec: Recommendation): Promise<RecommendationDetails | null> => {
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), 15000); // 15 second timeout

    try {
      const response = await fetch(
        `${getBackendUrl()}/api/v1/recommendations/${userId}/v2/details/${rec.vn_id}`,
        { signal: abortController.signal }
      );
      clearTimeout(timeoutHandle);
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      return data.details;
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('Failed to fetch details:', err);
      }
      return null;
    }
  };

  // Handle clicking the info button - fetch details if needed
  const handleInfoClick = async (rec: Recommendation) => {
    if (rec.details) {
      // Details already loaded, just show modal
      setSelectedRec(rec);
      return;
    }

    // Need to fetch details
    setSelectedRec(rec);  // Show modal with loading state
    setIsLoadingDetails(true);

    const details = await fetchDetailsForVn(rec);
    if (details) {
      // Update the recommendation with fetched details
      const updatedRec = { ...rec, details };
      setSelectedRec(updatedRec);
      // Also update in the main list so we don't refetch next time
      setRecommendations(prev =>
        prev.map(r => r.vn_id === rec.vn_id ? updatedRec : r)
      );
    }
    setIsLoadingDetails(false);
  };

  // Parse tag/trait filters from URL
  const parseFiltersFromUrl = () => {
    const filters: SelectedItem[] = [];

    // Parse include tags (format: "123:TagName,456:AnotherTag")
    const includeTagsParam = searchParams.get('includeTags');
    if (includeTagsParam) {
      includeTagsParam.split(',').forEach((item) => {
        const [id, name] = item.split(':');
        const parsedId = parseInt(id, 10);
        if (id && name && !isNaN(parsedId)) {
          filters.push({ id: parsedId, name: decodeURIComponent(name), type: 'tag', mode: 'include' });
        }
      });
    }

    // Parse exclude tags
    const excludeTagsParam = searchParams.get('excludeTags');
    if (excludeTagsParam) {
      excludeTagsParam.split(',').forEach((item) => {
        const [id, name] = item.split(':');
        const parsedId = parseInt(id, 10);
        if (id && name && !isNaN(parsedId)) {
          filters.push({ id: parsedId, name: decodeURIComponent(name), type: 'tag', mode: 'exclude' });
        }
      });
    }

    // Parse include traits
    const includeTraitsParam = searchParams.get('includeTraits');
    if (includeTraitsParam) {
      includeTraitsParam.split(',').forEach((item) => {
        const [id, name] = item.split(':');
        const parsedId = parseInt(id, 10);
        if (id && name && !isNaN(parsedId)) {
          filters.push({ id: parsedId, name: decodeURIComponent(name), type: 'trait', mode: 'include' });
        }
      });
    }

    // Parse exclude traits
    const excludeTraitsParam = searchParams.get('excludeTraits');
    if (excludeTraitsParam) {
      excludeTraitsParam.split(',').forEach((item) => {
        const [id, name] = item.split(':');
        const parsedId = parseInt(id, 10);
        if (id && name && !isNaN(parsedId)) {
          filters.push({ id: parsedId, name: decodeURIComponent(name), type: 'trait', mode: 'exclude' });
        }
      });
    }

    return filters;
  };

  // Load user from URL params (or reset when params are cleared)
  useEffect(() => {
    // Deduplicate: skip if searchParams string hasn't actually changed
    const paramsString = searchParams.toString();
    if (paramsString === lastProcessedParams.current) return;
    lastProcessedParams.current = paramsString;

    const uid = searchParams.get('uid');
    const uname = searchParams.get('username');
    // Validate uid format (numeric or u-prefixed numeric) to prevent path traversal
    if (uid && /^u?\d+$/.test(uid)) {
      setUserId(uid);
      if (uname) setUsername(uname);

      // Load filters from URL on initial page load
      const urlFilters = parseFiltersFromUrl();
      if (urlFilters.length > 0) {
        setTagTraitFilters(urlFilters);
      }

      // Pass parsed filters directly to avoid race condition with state updates
      fetchRecommendations(uid, urlFilters.length > 0 ? { tagTraitFilters: urlFilters } : undefined);
    } else {
      // Reset state when navigating back to landing page (no uid in URL)
      setUserId('');
      setUsername('');
      setRecommendations([]);
      setError(null);
      setTagTraitFilters([]);
    }
  }, [searchParams]);

  const handleUserSearch = async (e: FormEvent) => {
    e.preventDefault();
    const query = (e.target as HTMLFormElement).username.value.trim();
    if (!query) return;

    setIsLoadingUser(true);
    setUserError(null);

    try {
      const user = await vndbStatsApi.lookupUser(query);
      if (user) {
        setUserId(user.uid);
        setUsername(user.username);
        router.push(`/recommendations?uid=${user.uid}&username=${encodeURIComponent(user.username)}`);
        // useEffect watching searchParams will trigger the fetch
      } else {
        setUserError(`User "${query}" not found on VNDB, or their list may be private.`);
      }
    } catch {
      setUserError('Failed to look up user. Please try again.');
    } finally {
      setIsLoadingUser(false);
    }
  };

  const fetchRecommendations = async (uid: string, filterOverrides?: { tagTraitFilters?: SelectedItem[] }) => {
    // Clear any pending retry timer on fresh user-initiated fetch
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      retryCountRef.current = 0;
    }
    setIsLoading(true);
    setError(null);
    setFrontendTime(null);

    const startTime = performance.now();
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), 60000); // 60 second timeout for recommendations

    try {
      const params = new URLSearchParams({ limit: '100' });
      if (minRating) params.append('min_rating', minRating);
      // Convert length filters array to min/max for API
      if (lengthFilters.length > 0) {
        const sortedLengths = [...lengthFilters].map(Number).sort((a, b) => a - b);
        params.append('min_length', String(sortedLengths[0]));
        params.append('max_length', String(sortedLengths[sortedLengths.length - 1]));
      }
      params.append('japanese_only', japaneseOnly.toString());
      if (spoilerLevel > 0) params.append('spoiler_level', String(spoilerLevel));

      // Add tag/trait filters - use override if provided, otherwise fall back to state
      const activeTagTraitFilters = filterOverrides?.tagTraitFilters ?? tagTraitFilters;
      const includeTags = activeTagTraitFilters
        .filter((f) => f.type === 'tag' && f.mode === 'include')
        .map((f) => f.id);
      const excludeTags = activeTagTraitFilters
        .filter((f) => f.type === 'tag' && f.mode === 'exclude')
        .map((f) => f.id);
      const includeTraits = activeTagTraitFilters
        .filter((f) => f.type === 'trait' && f.mode === 'include')
        .map((f) => f.id);
      const excludeTraits = activeTagTraitFilters
        .filter((f) => f.type === 'trait' && f.mode === 'exclude')
        .map((f) => f.id);

      if (includeTags.length > 0) params.append('include_tags', includeTags.join(','));
      if (excludeTags.length > 0) params.append('exclude_tags', excludeTags.join(','));
      if (includeTraits.length > 0) params.append('include_traits', includeTraits.join(','));
      if (excludeTraits.length > 0) params.append('exclude_traits', excludeTraits.join(','));

      // Note: Remove skip_cache once backend caching is verified to work correctly
      // params.append('skip_cache', 'true');

      const response = await fetch(
        `${getBackendUrl()}/api/v1/recommendations/${uid}/v2?${params}`,
        { signal: abortController.signal }
      );
      clearTimeout(timeoutHandle);

      if (!response.ok) {
        throw new Error('Failed to fetch recommendations');
      }

      const data: RecommendationsResponse = await response.json();
      const endTime = performance.now();

      setRecommendations(data.recommendations);
      setElapsedTime(data.elapsed_seconds);
      setFrontendTime((endTime - startTime) / 1000);
    } catch (err) {
      clearTimeout(timeoutHandle);

      // Auto-retry up to 2 times with 10s delay (handles import-in-progress)
      if (retryCountRef.current < 2) {
        retryCountRef.current++;
        console.log(`Recommendations fetch failed, retrying (${retryCountRef.current}/2) in 10s...`);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          fetchRecommendations(uid, filterOverrides);
        }, 10000);
        return; // Keep loading state active
      }

      retryCountRef.current = 0;
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Request timed out. The server may be busy - please try again.');
      } else {
        console.error('Failed to load recommendations:', err);
        setError('Failed to load recommendations. Data may be refreshing — please try again in a few minutes.');
      }
    } finally {
      // Only clear loading if we're not auto-retrying
      if (retryCountRef.current === 0) {
        setIsLoading(false);
      }
    }
  };

  const applyFilters = () => {
    if (userId) {
      // Update URL with current filter state
      const params = new URLSearchParams();
      params.set('uid', userId);
      if (username) params.set('username', username);

      // Add tag/trait filters to URL (format: "id:name,id:name")
      const includeTags = tagTraitFilters
        .filter((f) => f.type === 'tag' && f.mode === 'include')
        .map((f) => `${f.id}:${encodeURIComponent(f.name)}`)
        .join(',');
      const excludeTags = tagTraitFilters
        .filter((f) => f.type === 'tag' && f.mode === 'exclude')
        .map((f) => `${f.id}:${encodeURIComponent(f.name)}`)
        .join(',');
      const includeTraits = tagTraitFilters
        .filter((f) => f.type === 'trait' && f.mode === 'include')
        .map((f) => `${f.id}:${encodeURIComponent(f.name)}`)
        .join(',');
      const excludeTraits = tagTraitFilters
        .filter((f) => f.type === 'trait' && f.mode === 'exclude')
        .map((f) => `${f.id}:${encodeURIComponent(f.name)}`)
        .join(',');

      if (includeTags) params.set('includeTags', includeTags);
      if (excludeTags) params.set('excludeTags', excludeTags);
      if (includeTraits) params.set('includeTraits', includeTraits);
      if (excludeTraits) params.set('excludeTraits', excludeTraits);

      const paramsString = params.toString();

      // Update ref so the searchParams effect doesn't trigger a duplicate fetch
      lastProcessedParams.current = paramsString;

      // Update URL without triggering navigation (to avoid resetting state)
      window.history.replaceState(null, '', `?${paramsString}`);

      fetchRecommendations(userId);
    }
  };

  const clearFilters = () => {
    setMinRating('');
    setLengthFilters([]);
    setJapaneseOnly(true);
    setSpoilerLevel(0);
    setTagTraitFilters([]);

    if (userId) {
      // Update URL to remove filter params
      const params = new URLSearchParams();
      params.set('uid', userId);
      if (username) params.set('username', username);
      const paramsString = params.toString();

      // Update ref so the searchParams effect doesn't trigger a duplicate fetch
      lastProcessedParams.current = paramsString;

      window.history.replaceState(null, '', `?${paramsString}`);

      fetchRecommendations(userId);
    }
  };

  return (
    <ErrorBoundary>
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-violet-100 dark:bg-violet-900/30 mb-4">
            <Sparkles className="w-10 h-10 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex flex-col items-center gap-2 mb-3">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
              VN Recommendations
            </h1>
            <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
              BETA
            </span>
          </div>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Personalized recommendations based on your VNDB ratings
          </p>
        </div>

        {/* How It Works Dropdown */}
        <div className="mb-8 max-w-2xl mx-auto">
          <button
            onClick={() => setShowHowItWorks(!showHowItWorks)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
          >
            <Info className="w-4 h-4" />
            How recommendations work
            {showHowItWorks ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showHowItWorks && (
            <div className="mt-3 p-5 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl">
              <HowItWorksAccordion />
            </div>
          )}
        </div>

        {/* User Search - show when no user selected */}
        {!userId && (
          <>
            <form onSubmit={handleUserSearch} className="mb-8">
              <div className="relative max-w-lg mx-auto">
                <input
                  type="text"
                  name="username"
                  placeholder="Enter your VNDB username"
                  className="w-full px-5 py-4 pr-14 text-lg rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:border-violet-500 dark:focus:border-violet-400 transition-colors"
                  disabled={isLoadingUser}
                />
                <button
                  type="submit"
                  disabled={isLoadingUser}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoadingUser ? (
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Search className="w-6 h-6" />
                  )}
                </button>
              </div>
              {userError && (
                <p className="mt-3 text-center text-red-500 dark:text-red-400">{userError}</p>
              )}
            </form>

            {/* Features */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left max-w-2xl mx-auto">
              <FeatureCard
                icon={<TrendingUp className="w-6 h-6" />}
                title="Tag Analysis"
                description="Matches based on your preferred themes and content tags"
              />
              <FeatureCard
                icon={<Users className="w-6 h-6" />}
                title="Similar Tastes"
                description="VNs loved by users with similar reading history"
              />
              <FeatureCard
                icon={<BookOpen className="w-6 h-6" />}
                title="Staff Matching"
                description="Works by your favorite writers and developers"
              />
            </div>

            {/* Note */}
            <div className="mt-10 text-sm text-gray-500 dark:text-gray-500 text-center">
              <p>Your VNDB list must be public for recommendations to be generated.</p>
            </div>
          </>
        )}

        {/* User Info & Filters - show when user is selected */}
        {userId && (
          <div className="mb-6 max-w-3xl mx-auto">
            {/* User info row */}
            <div className="flex items-center gap-2 text-sm mb-4">
              <span className="text-gray-500 dark:text-gray-400">Recommendations for</span>
              <Link
                href={`/stats/${userId}`}
                className="font-semibold text-violet-600 dark:text-violet-400 hover:underline"
              >
                {username || userId}
              </Link>
              <button
                onClick={() => {
                  setUserId('');
                  setUsername('');
                  setRecommendations([]);
                  router.push('/recommendations');
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                title="Change user"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Compact Filter Bar */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 mb-4 space-y-4">
              {/* Tag/Trait Search */}
              <div className="flex gap-2 items-start">
                <div className="flex-1">
                  <TagTraitAutocomplete
                    selectedItems={tagTraitFilters}
                    onSelectionChange={(items) => {
                      setTagTraitFilters(items);
                    }}
                    placeholder="Filter by tags or traits..."
                    maxItems={10}
                  />
                </div>
              </div>

              {/* Compact Filter Dropdowns & Chips */}
              <CompactRecommendationFilters
                filters={{
                  minRating,
                  length: lengthFilters,
                  japaneseOnly,
                  spoilerLevel,
                }}
                onFilterChange={(changes) => {
                  if (changes.minRating !== undefined) setMinRating(changes.minRating);
                  if (changes.length !== undefined) setLengthFilters(changes.length);
                  if (changes.japaneseOnly !== undefined) setJapaneseOnly(changes.japaneseOnly);
                  if (changes.spoilerLevel !== undefined) setSpoilerLevel(changes.spoilerLevel);
                }}
                tagTraitFilters={tagTraitFilters}
                onRemoveTagTrait={(index) => {
                  const newItems = [...tagTraitFilters];
                  newItems.splice(index, 1);
                  setTagTraitFilters(newItems);
                }}
                onToggleTagTraitMode={(index) => {
                  const newItems = [...tagTraitFilters];
                  newItems[index] = {
                    ...newItems[index],
                    mode: newItems[index].mode === 'include' ? 'exclude' : 'include',
                  };
                  setTagTraitFilters(newItems);
                }}
                onClearAll={clearFilters}
              />

              {/* Apply Button */}
              <div className="flex justify-end">
                <button
                  onClick={applyFilters}
                  className="px-4 py-2 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="text-center py-12">
            <p className="text-red-500 mb-4">{error}</p>
            <button
              onClick={() => { retryCountRef.current = 0; userId && fetchRecommendations(userId); }}
              className="px-4 py-2 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Crossfade Container - Skeleton and Content */}
        {userId && !error && (
          <FadeIn duration={200}>
            <div className="relative min-h-[200px]">
            {/* Skeleton Grid - fades OUT when not loading */}
            <div
              className={`transition-opacity duration-300 ${
                isLoading ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0'
              }`}
            >
              <div className="flex flex-col items-center justify-center mb-4 gap-1">
                <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <span className="animate-spin rounded-full h-4 w-4 border-2 border-violet-200 border-t-violet-600" />
                  {loadingElapsed < 5 ? 'Analyzing your ratings...' :
                   loadingElapsed < 15 ? 'Generating recommendations...' :
                   'Processing large collection...'}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {loadingElapsed}s elapsed
                  {loadingElapsed >= 15 && ' — Almost there!'}
                  {loadingElapsed >= 30 && ' (Very large collections may take up to 60s)'}
                </p>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-gray-50 dark:bg-gray-800/50 rounded-lg overflow-hidden border border-gray-100 dark:border-gray-700"
                  >
                    {/* Skeleton Image */}
                    <div className="relative aspect-3/4 bg-gray-200 dark:bg-gray-700 overflow-hidden">
                      <div className="absolute inset-0 bg-linear-to-r from-transparent via-gray-300/50 dark:via-gray-600/50 to-transparent animate-shimmer" />
                      {/* Skeleton Rank Badge */}
                      <div className="absolute top-2 left-2 w-8 h-5 bg-gray-300 dark:bg-gray-600 rounded-sm" />
                      {/* Skeleton Match Score */}
                      <div className="absolute bottom-2 left-2 w-12 h-5 bg-violet-300/50 dark:bg-violet-700/50 rounded-sm" />
                    </div>
                    {/* Skeleton Content */}
                    <div className="p-2 space-y-1.5">
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-sm w-full" />
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-sm w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Content Grid - fades IN when loaded */}
            {recommendations.length > 0 && (
              <div
                className={`transition-opacity duration-300 ${
                  !isLoading ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
              >
                <div className="flex items-center justify-center mb-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Found {recommendations.length} recommendations
                    {frontendTime && ` in ${frontendTime.toFixed(1)}s`}
                    {elapsedTime && frontendTime && frontendTime > elapsedTime + 2 && (
                      <span className="text-gray-400 ml-1">
                        (backend: {elapsedTime.toFixed(1)}s)
                      </span>
                    )}
                  </p>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {recommendations.map((rec, index) => (
                    <RecommendationCard
                      key={rec.vn_id}
                      rec={rec}
                      index={index}
                      titlePreference={titlePreference}
                      onInfoClick={handleInfoClick}
                    />
                  ))}
                </div>
              </div>
            )}
            </div>
          </FadeIn>
        )}

        {/* Empty State */}
        {!isLoading && !error && userId && recommendations.length === 0 && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
              <Sparkles className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-2">
              No recommendations found.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500">
              Make sure your VNDB list is set to public and that you have rated some VNs. You can also try adjusting your filters.
            </p>
          </div>
        )}
      </div>

      {/* Recommendation Detail Modal */}
      {selectedRec && (
        <RecommendationDetailModal
          recommendation={selectedRec}
          onClose={() => setSelectedRec(null)}
          isLoading={isLoadingDetails}
        />
      )}
    </div>
    </ErrorBoundary>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-5 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 mb-3">
        {icon}
      </div>
      <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
        {title}
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {description}
      </p>
    </div>
  );
}
