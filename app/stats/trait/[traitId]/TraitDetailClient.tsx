'use client';

import { useEffect, useState, use, Fragment, useRef, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, ExternalLink, Heart, Star, Users,
  AlertCircle, RefreshCw, BookOpen, Tags, ChevronRight
} from 'lucide-react';
import { parseBBCode } from '@/lib/bbcode';
import { Pagination, PaginationSkeleton } from '@/components/browse/Pagination';
import {
  vndbStatsApi,
  TraitDetail,
  TraitCharacter,
  TraitStatsData,
  SimilarTraitResult,
  RelatedTag,
  TagVN,
  TraitParent,
  TraitChild,
} from '@/lib/vndb-stats-api';
import { StatsSummaryCard } from '@/components/stats/StatsSummaryCard';
import { ScoreDistributionChart } from '@/components/stats/ScoreDistributionChart';
import { ReleaseYearChart } from '@/components/stats/ReleaseYearChart';
import { LengthChart } from '@/components/stats/LengthChart';
import { AgeRatingChart } from '@/components/stats/AgeRatingChart';
import { TraitDetailTabs, TraitTabId } from '@/components/stats/TraitDetailTabs';
import { LoadingScreen } from '@/components/LoadingScreen';
import { consumePendingScroll } from '@/components/ScrollToTop';

const VALID_TABS: TraitTabId[] = ['summary', 'characters', 'novels', 'similar-traits', 'related-tags'];
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { LanguageFilter, LanguageFilterValue } from '@/components/stats/LanguageFilter';
import { SpoilerFilter, SpoilerFilterValue } from '@/components/stats/SpoilerFilter';
import { LastUpdated } from '@/components/stats/LastUpdated';
import { sortTagsByWeight } from '@/lib/weighted-score-utils';
import { NSFWImage } from '@/components/NSFWImage';

/** Preload VN cover images into browser cache using Image() objects */
function preloadVNImages(vns: Array<{ image_url?: string | null; id: string }>) {
  vns.forEach(vn => {
    if (vn.image_url) {
      const img = new Image();
      const url = getProxiedImageUrl(vn.image_url, { vnId: vn.id });
      if (url) img.src = url;
    }
  });
}

/** Preload character images into browser cache */
function preloadCharacterImages(chars: Array<{ image_url?: string | null }>) {
  chars.forEach(c => {
    if (c.image_url) {
      const img = new Image();
      const url = getProxiedImageUrl(c.image_url);
      if (url) img.src = url;
    }
  });
}

interface PageProps {
  params: Promise<{ traitId: string }>;
}

// Validate VNDB trait ID format: "i" followed by one or more digits
function isValidTraitId(id: string): boolean {
  return /^i\d+$/.test(id);
}

export default function TraitDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const traitId = resolvedParams.traitId;

  // Validate trait ID format before using it
  if (!isValidTraitId(traitId)) {
    return <ErrorState error={`Invalid trait ID format: "${traitId}". Expected format like "i123".`} traitId={traitId} />;
  }

  // URL-based tab + page state
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabFromUrl = searchParams.get('tab') as TraitTabId | null;
  const pageFromUrl = searchParams.get('page');
  const initialTab: TraitTabId = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'summary';
  const initialPage = pageFromUrl ? Math.max(1, parseInt(pageFromUrl, 10) || 1) : 1;

  const [trait, setTrait] = useState<TraitDetail | null>(null);
  const [stats, setStats] = useState<TraitStatsData | null>(null);
  const [characters, setCharacters] = useState<TraitCharacter[]>([]);
  const [vns, setVns] = useState<TagVN[]>([]);
  const [similarTraits, setSimilarTraits] = useState<SimilarTraitResult[]>([]);
  const [relatedTags, setRelatedTags] = useState<RelatedTag[]>([]);
  const [parents, setParents] = useState<TraitParent[]>([]);
  const [children, setChildren] = useState<TraitChild[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingTab, setIsLoadingTab] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TraitTabId>(initialTab);
  const [usingFallback, setUsingFallback] = useState(false);
  const [languageFilter, setLanguageFilter] = useState<LanguageFilterValue>('ja');
  const [spoilerFilter, setSpoilerFilter] = useState<SpoilerFilterValue>(0);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [currentPage, setCurrentPage] = useState(initialTab === 'novels' ? initialPage : 1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalVns, setTotalVns] = useState(0);
  const [charsPage, setCharsPage] = useState(initialTab === 'characters' ? initialPage : 1);
  const [charsTotal, setCharsTotal] = useState(0);
  const [charsPages, setCharsPages] = useState(1);

  const updateUrl = useCallback((tab: TraitTabId, page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'summary') params.delete('tab');
    else params.set('tab', tab);
    if (page <= 1) params.delete('page');
    else params.set('page', String(page));
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [pathname, router, searchParams]);

  // Refs for caching previous data during pagination (smooth loading overlay)
  const previousCharsRef = useRef<TraitCharacter[]>([]);
  const previousVnsRef = useRef<TagVN[]>([]);
  // Track whether we've attempted to load each tab (to avoid flashing "no results" before load starts)
  const hasAttemptedCharsRef = useRef(false);
  const hasAttemptedVnsRef = useRef(false);
  // Refs for prefetched pages cache
  const charsPrefetchCacheRef = useRef<Map<string, { characters: TraitCharacter[]; page: number; pages: number; total: number }>>(new Map());
  const vnsPrefetchCacheRef = useRef<Map<string, { vns: TagVN[]; page: number; pages: number; total: number }>>(new Map());
  // Refs for scroll targets
  const charsResultsRef = useRef<HTMLDivElement>(null);
  const vnsResultsRef = useRef<HTMLDivElement>(null);
  // Track whether this is the initial mount after a back navigation (for scroll restoration)
  const isInitialBackNavRef = useRef(false);

  // Detect back navigation on mount for scroll restoration
  useEffect(() => {
    const isBackNav = sessionStorage.getItem('is-popstate-navigation') === 'true';
    sessionStorage.removeItem('is-popstate-navigation');
    if (isBackNav) {
      isInitialBackNavRef.current = true;
    }
  }, []);

  // Handle tab change - update URL and reset page
  const handleTabChange = useCallback((newTab: TraitTabId) => {
    setActiveTab(newTab);
    setCurrentPage(1);
    setCharsPage(1);
    setVns([]);
    setCharacters([]);
    hasAttemptedVnsRef.current = false;
    hasAttemptedCharsRef.current = false;
    charsPrefetchCacheRef.current.clear();
    vnsPrefetchCacheRef.current.clear();
    updateUrl(newTab, 1);
  }, [updateUrl]);

  // Handle page change for characters tab
  const handleCharsPageChange = useCallback((newPage: number) => {
    loadCharacters(newPage);
    updateUrl(activeTab, newPage);
  }, [activeTab, updateUrl]);

  // Handle page change for novels tab
  const handleVnsPageChange = useCallback((newPage: number) => {
    loadNovels(newPage);
    updateUrl(activeTab, newPage);
  }, [activeTab, updateUrl]);

  // Sync URL -> state for back/forward navigation
  useEffect(() => {
    const urlTab = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'summary';
    const urlPage = pageFromUrl ? Math.max(1, parseInt(pageFromUrl, 10) || 1) : 1;
    const tabChanged = urlTab !== activeTab;

    if (tabChanged) {
      setActiveTab(urlTab);
      if (urlTab === 'characters') setCharsPage(urlPage);
      else if (urlTab === 'novels') setCurrentPage(urlPage);
      setVns([]);
      setCharacters([]);
      hasAttemptedVnsRef.current = false;
      hasAttemptedCharsRef.current = false;
      charsPrefetchCacheRef.current.clear();
      vnsPrefetchCacheRef.current.clear();
    } else if (urlTab === 'characters' && urlPage !== charsPage && characters.length > 0) {
      setCharsPage(urlPage);
      loadCharacters(urlPage);
    } else if (urlTab === 'novels' && urlPage !== currentPage && vns.length > 0) {
      setCurrentPage(urlPage);
      loadNovels(urlPage);
    }
  }, [tabFromUrl, pageFromUrl]);

  useEffect(() => {
    loadInitialData();
  }, [traitId]);

  // Set page title
  useEffect(() => {
    if (trait) {
      document.title = `${trait.name} - Trait Stats | VN Club`;
    }
  }, [trait]);

  // Lazy load tab data
  useEffect(() => {
    if (activeTab === 'characters' && characters.length === 0 && !isLoadingTab) {
      loadCharacters(charsPage);
    } else if (activeTab === 'novels' && vns.length === 0 && !isLoadingTab) {
      loadNovels(currentPage);
    } else if (activeTab === 'similar-traits' && similarTraits.length === 0 && !isLoadingTab) {
      loadSimilarTraits();
    } else if (activeTab === 'related-tags' && relatedTags.length === 0 && !isLoadingTab) {
      loadRelatedTags();
    }
  }, [activeTab, characters.length, vns.length]);

  const loadInitialData = async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);

    try {
      // Check if we're using fallback mode (direct VNDB API instead of backend)
      const fallbackMode = await vndbStatsApi.isUsingFallback();
      setUsingFallback(fallbackMode);

      // Load trait info, stats, and hierarchy in parallel
      const [traitData, statsData, parentsData, childrenData] = await Promise.all([
        vndbStatsApi.getTrait(traitId),
        vndbStatsApi.getTraitStats(traitId, { nocache: forceRefresh }),
        vndbStatsApi.getTraitParents(traitId),
        vndbStatsApi.getTraitChildren(traitId),
      ]);

      if (!traitData) {
        // For meta-traits, we may not get trait data but still have children
        if (childrenData.length === 0 && parentsData.length === 0) {
          setError('Trait not found.');
          return;
        }

        // Try to get trait name from parent's children list
        let traitName = traitId.replace(/^i/, 'Trait ');
        if (parentsData.length > 0) {
          const immediateParent = parentsData[parentsData.length - 1];
          try {
            const parentChildren = await vndbStatsApi.getTraitChildren(immediateParent.id);
            const numericId = traitId.startsWith('i') ? traitId.substring(1) : traitId;
            const thisTraitInParent = parentChildren.find(c => c.id === numericId || c.id === traitId);
            if (thisTraitInParent) {
              traitName = thisTraitInParent.name;
            }
          } catch {
            // Failed to get parent's children, use fallback name
          }
        }

        // Create minimal trait object for meta-traits
        setTrait({
          id: traitId,
          name: traitName,
          applicable: false,
        } as TraitDetail);
      } else {
        setTrait(traitData);
      }
      setStats(statsData);
      setParents(parentsData);
      setChildren(childrenData);
    } catch {
      setError('Failed to load trait data.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadInitialData(true);
    setIsRefreshing(false);
  };

  const loadCharacters = async (page: number = 1, olang: string = languageFilter) => {
    hasAttemptedCharsRef.current = true;
    const cacheKey = `${page}-${olang}`;

    // Check prefetch cache first
    if (charsPrefetchCacheRef.current.has(cacheKey)) {
      const cached = charsPrefetchCacheRef.current.get(cacheKey)!;
      charsPrefetchCacheRef.current.delete(cacheKey);
      setCharacters(cached.characters);
      previousCharsRef.current = cached.characters;
      setCharsPage(cached.page);
      setCharsTotal(cached.total);
      setCharsPages(cached.pages);

      // Prefetch next page
      if (cached.page < cached.pages) {
        const nextKey = `${cached.page + 1}-${olang}`;
        if (!charsPrefetchCacheRef.current.has(nextKey)) {
          vndbStatsApi.getTraitCharacters(traitId, cached.page + 1, 24, olang === 'all' ? undefined : olang)
            .then(result => {
              if (result) {
                charsPrefetchCacheRef.current.set(nextKey, result);
                preloadCharacterImages(result.characters);
              }
            })
            .catch(() => {});
        }
      }
      if (isInitialBackNavRef.current) {
        isInitialBackNavRef.current = false;
        consumePendingScroll();
      }
      return;
    }

    setIsLoadingTab(true);
    try {
      const response = await vndbStatsApi.getTraitCharacters(
        traitId,
        page,
        24,
        olang === 'all' ? undefined : olang
      );
      if (response) {
        setCharacters(response.characters);
        previousCharsRef.current = response.characters; // Cache for smooth loading overlay
        setCharsPage(response.page);
        setCharsTotal(response.total);
        setCharsPages(response.pages);

        // Prefetch next page
        if (response.page < response.pages) {
          const nextKey = `${response.page + 1}-${olang}`;
          if (!charsPrefetchCacheRef.current.has(nextKey)) {
            vndbStatsApi.getTraitCharacters(traitId, response.page + 1, 24, olang === 'all' ? undefined : olang)
              .then(result => {
                if (result) {
                  charsPrefetchCacheRef.current.set(nextKey, result);
                  preloadCharacterImages(result.characters);
                }
              })
              .catch(() => {});
          }
        }
      }
    } catch {
      // Characters are optional, silently fail
    } finally {
      setIsLoadingTab(false);
      // On initial back navigation, restore scroll after content loads
      if (isInitialBackNavRef.current) {
        isInitialBackNavRef.current = false;
        consumePendingScroll();
      }
    }
  };

  const loadNovels = async (page: number = 1, spoilerLevel: number = spoilerFilter, olang: string = languageFilter) => {
    hasAttemptedVnsRef.current = true;
    const cacheKey = `${page}-${spoilerLevel}-${olang}`;

    // Check prefetch cache first
    if (vnsPrefetchCacheRef.current.has(cacheKey)) {
      const cached = vnsPrefetchCacheRef.current.get(cacheKey)!;
      vnsPrefetchCacheRef.current.delete(cacheKey);
      setVns(cached.vns);
      previousVnsRef.current = cached.vns;
      setCurrentPage(cached.page);
      setTotalPages(cached.pages);
      setTotalVns(cached.total);

      // Prefetch next page
      if (cached.page < cached.pages) {
        const nextKey = `${cached.page + 1}-${spoilerLevel}-${olang}`;
        if (!vnsPrefetchCacheRef.current.has(nextKey)) {
          vndbStatsApi.getTraitVNsWithTags(traitId, cached.page + 1, 24, 'rating', spoilerLevel, olang === 'all' ? undefined : olang)
            .then(result => {
              if (result) {
                vnsPrefetchCacheRef.current.set(nextKey, result);
                preloadVNImages(result.vns);
              }
            })
            .catch(() => {});
        }
      }
      if (isInitialBackNavRef.current) {
        isInitialBackNavRef.current = false;
        consumePendingScroll();
      }
      return;
    }

    setIsLoadingTab(true);
    try {
      const response = await vndbStatsApi.getTraitVNsWithTags(traitId, page, 24, 'rating', spoilerLevel, olang === 'all' ? undefined : olang);
      if (response) {
        setVns(response.vns);
        previousVnsRef.current = response.vns; // Cache for smooth loading overlay
        setCurrentPage(response.page);
        setTotalPages(response.pages);
        setTotalVns(response.total);

        // Prefetch next page
        if (response.page < response.pages) {
          const nextKey = `${response.page + 1}-${spoilerLevel}-${olang}`;
          if (!vnsPrefetchCacheRef.current.has(nextKey)) {
            vndbStatsApi.getTraitVNsWithTags(traitId, response.page + 1, 24, 'rating', spoilerLevel, olang === 'all' ? undefined : olang)
              .then(result => {
                if (result) {
                  vnsPrefetchCacheRef.current.set(nextKey, result);
                  preloadVNImages(result.vns);
                }
              })
              .catch(() => {});
          }
        }
      }
    } catch {
      // Novels are optional, silently fail
    } finally {
      setIsLoadingTab(false);
      if (isInitialBackNavRef.current) {
        isInitialBackNavRef.current = false;
        consumePendingScroll();
      }
    }
  };

  const handleSpoilerChange = useCallback((value: SpoilerFilterValue) => {
    vnsPrefetchCacheRef.current.clear();
    setSpoilerFilter(value);
    setCurrentPage(1);
    loadNovels(1, value);
    updateUrl(activeTab, 1);
  }, [activeTab, updateUrl]);

  const handleLanguageChange = useCallback((value: LanguageFilterValue) => {
    vnsPrefetchCacheRef.current.clear();
    charsPrefetchCacheRef.current.clear();
    setLanguageFilter(value);
    setCurrentPage(1);
    setCharsPage(1);
    loadNovels(1, spoilerFilter, value);
    updateUrl(activeTab, 1);
  }, [activeTab, spoilerFilter, updateUrl]);

  const loadSimilarTraits = async () => {
    setIsLoadingTab(true);
    try {
      const data = await vndbStatsApi.getSimilarTraits(traitId, 30);
      setSimilarTraits(data);
    } catch {
      // Similar traits are optional, silently fail
    } finally {
      setIsLoadingTab(false);
      if (isInitialBackNavRef.current) {
        isInitialBackNavRef.current = false;
        consumePendingScroll();
      }
    }
  };

  const loadRelatedTags = async () => {
    setIsLoadingTab(true);
    try {
      const data = await vndbStatsApi.getTraitTags(traitId, 30);
      setRelatedTags(data);
    } catch {
      // Related tags are optional, silently fail
    } finally {
      setIsLoadingTab(false);
      if (isInitialBackNavRef.current) {
        isInitialBackNavRef.current = false;
        consumePendingScroll();
      }
    }
  };

  if (isLoading) {
    return <LoadingScreen title="Loading trait stats..." subtitle="Crunching VNDB data for this trait" />;
  }

  if (error || !trait) {
    return <ErrorState error={error} traitId={traitId} />;
  }

  return (
    <div className="relative max-w-7xl mx-auto px-4 py-8 overflow-x-hidden">
      {isRefreshing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-gray-800 shadow border border-gray-200 dark:border-gray-700">
            <RefreshCw className="w-4 h-4 animate-spin text-primary-500" />
            <span className="text-sm text-gray-700 dark:text-gray-200">Refreshing…</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div className="flex items-start gap-4">
          <button
            onClick={() => window.history.back()}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors mt-1"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <div>
            {/* Breadcrumb */}
            {parents.length > 0 && (
              <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mb-2 flex-wrap">
                <Link href="/browse?tab=traits" className="hover:text-primary-600 dark:hover:text-primary-400">Traits</Link>
                {parents.map((p) => (
                  <Fragment key={p.id}>
                    <ChevronRight className="w-3 h-3 flex-shrink-0" />
                    <Link
                      href={`/stats/trait/${p.id}`}
                      className="hover:text-primary-600 dark:hover:text-primary-400"
                    >
                      {p.name}
                    </Link>
                  </Fragment>
                ))}
                <ChevronRight className="w-3 h-3 flex-shrink-0" />
                <span className="text-gray-700 dark:text-gray-300">{trait.name}</span>
              </div>
            )}
            <div className="flex items-center gap-2 mb-1">
              <Heart className="w-5 h-5 text-pink-500" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {trait.name}
              </h1>
              {trait.group_name && (
                <span className="px-2 py-0.5 text-xs rounded bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400">
                  {trait.group_name}
                </span>
              )}
            </div>
            <a
              href={`https://vndb.org/${trait.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center gap-1"
            >
              View on VNDB <ExternalLink className="w-3 h-3" />
            </a>
            {trait.description && (
              <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 max-w-2xl break-words">
                <p>
                  {parseBBCode(
                    !showFullDescription && trait.description.length > 300
                      ? trait.description.substring(0, 300) + '...'
                      : trait.description
                  )}
                </p>
                {trait.description.length > 300 && (
                  <button
                    onClick={() => setShowFullDescription(!showFullDescription)}
                    className="mt-1 text-primary-600 dark:text-primary-400 hover:underline text-sm"
                  >
                    {showFullDescription ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <LastUpdated timestamp={stats?.last_updated} />
        </div>
      </div>

      {/* Fallback Mode Warning */}
      {usingFallback && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                Limited Data Mode
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                Showing partial data. Statistics may be less accurate than usual. Please try again later for full results.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <TraitDetailTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        counts={{
          characters: trait.char_count,
          novels: stats?.total_vns,
        }}
      />

      {/* Summary Tab */}
      {activeTab === 'summary' && (
        <>
          {/* Child Traits */}
          {children.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none mb-8">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                Child Traits ({children.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {children.map(child => (
                  <Link
                    key={child.id}
                    href={`/stats/trait/${child.id}`}
                    className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm hover:bg-pink-100 dark:hover:bg-pink-900/30 hover:text-pink-700 dark:hover:text-pink-300 transition-colors"
                  >
                    {child.name}
                    {child.char_count !== undefined && child.char_count > 0 && (
                      <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                        ({child.char_count.toLocaleString()})
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Meta-trait notice for non-applicable traits */}
          {trait.applicable === false && (
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-6 border border-gray-100 dark:border-gray-700 text-center mb-8">
              <p className="text-gray-500 dark:text-gray-400">
                This is a meta-trait used for categorization. Browse the child traits above to find characters.
              </p>
            </div>
          )}

          {/* Only show stats and charts for applicable traits with data */}
          {stats && trait.applicable !== false && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
                <StatsSummaryCard
                  icon={<Star className="w-5 h-5" />}
                  label="Average Rating"
                  value={stats.average_rating > 0 ? stats.average_rating.toFixed(2) : 'N/A'}
                  subtext={`from ${stats.total_vns.toLocaleString()} VNs`}
                />
                <StatsSummaryCard
                  icon={<BookOpen className="w-5 h-5" />}
                  label="VNs with Trait"
                  value={stats.total_vns.toLocaleString()}
                  subtext="visual novels"
                />
                <StatsSummaryCard
                  icon={<Users className="w-5 h-5" />}
                  label="Characters"
                  value={trait.char_count?.toLocaleString() || stats.total_characters.toLocaleString()}
                  subtext="with this trait"
                />
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <ScoreDistributionChart
                  distribution={stats.score_distribution}
                  jpDistribution={stats.score_distribution_jp}
                  average={stats.average_rating}
                  entityId={traitId}
                  entityType="trait"
                />
                <ReleaseYearChart
                  distribution={stats.release_year_distribution}
                  distributionWithRatings={stats.release_year_with_ratings}
                  entityId={traitId}
                  entityType="trait"
                />
                <LengthChart
                  distribution={stats.length_distribution}
                  entityId={traitId}
                  entityType="trait"
                />
                {Object.keys(stats.age_rating_distribution).length > 0 && (
                  <AgeRatingChart
                    distribution={stats.age_rating_distribution}
                    entityId={traitId}
                    entityType="trait"
                  />
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Characters Tab */}
      {activeTab === 'characters' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {charsTotal > 0 && `${charsTotal.toLocaleString()} characters`}
            </p>
            <LanguageFilter value={languageFilter} onChange={(val) => { charsPrefetchCacheRef.current.clear(); setLanguageFilter(val); setCharsPage(1); loadCharacters(1, val); updateUrl(activeTab, 1); }} />
          </div>

          {/* Initial load: show skeleton grid with pagination skeleton */}
          {(isLoadingTab || !hasAttemptedCharsRef.current) && characters.length === 0 && previousCharsRef.current.length === 0 ? (
            <>
              <PaginationSkeleton />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <CharacterCardSkeleton key={i} />
                ))}
              </div>
              <PaginationSkeleton />
            </>
          ) : (
            /* Content with loading overlay - keeps previous content visible during pagination */
            <div>
              {/* Content - show current or cached data */}
              {(characters.length > 0 || previousCharsRef.current.length > 0) ? (
                <div className={`transition-opacity duration-150 ${isLoadingTab ? 'opacity-60 pointer-events-none' : ''}`}>
                  {charsPages > 1 && (
                    <Pagination
                      currentPage={charsPage}
                      totalPages={charsPages}
                      onPageChange={handleCharsPageChange}
                      totalItems={charsTotal}
                      itemsPerPage={24}
                    />
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(characters.length > 0 ? characters : previousCharsRef.current).map((char) => (
                      <CharacterCard key={char.id} character={char} />
                    ))}
                  </div>
                  {charsPages > 1 && (
                    <Pagination
                      currentPage={charsPage}
                      totalPages={charsPages}
                      onPageChange={handleCharsPageChange}
                      totalItems={charsTotal}
                      itemsPerPage={24}
                      scrollToTop={true}
                    />
                  )}
                </div>
              ) : hasAttemptedCharsRef.current && (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No characters found with this trait{languageFilter === 'ja' ? ' in Japanese visual novels' : ''}.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Novels Tab */}
      {activeTab === 'novels' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {totalVns > 0 && `${totalVns.toLocaleString()} visual novels`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <SpoilerFilter value={spoilerFilter} onChange={handleSpoilerChange} />
              <LanguageFilter value={languageFilter} onChange={handleLanguageChange} />
            </div>
          </div>

          {/* Initial load: show skeleton grid with pagination skeleton */}
          {(isLoadingTab || !hasAttemptedVnsRef.current) && vns.length === 0 && previousVnsRef.current.length === 0 ? (
            <>
              <PaginationSkeleton />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <VNCardSkeleton key={i} />
                ))}
              </div>
              <PaginationSkeleton />
            </>
          ) : (
            /* Content with loading overlay - keeps previous content visible during pagination */
            <div>
              {/* Content - show current or cached data */}
              {(vns.length > 0 || previousVnsRef.current.length > 0) ? (
                <div className={`transition-opacity duration-150 ${isLoadingTab ? 'opacity-60 pointer-events-none' : ''}`}>
                  {totalPages > 1 && (
                    <Pagination
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={handleVnsPageChange}
                      totalItems={totalVns}
                      itemsPerPage={24}
                    />
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(vns.length > 0 ? vns : previousVnsRef.current).map((vn) => (
                      <VNCard key={vn.id} vn={vn} />
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <Pagination
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={handleVnsPageChange}
                      totalItems={totalVns}
                      itemsPerPage={24}
                      scrollToTop={true}
                    />
                  )}
                </div>
              ) : hasAttemptedVnsRef.current && (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No visual novels found with characters having this trait{languageFilter === 'ja' ? ' (Japanese only)' : ''}.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Similar Traits Tab */}
      {activeTab === 'similar-traits' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          {isLoadingTab ? (
            <LoadingTabContent message="Loading similar traits..." />
          ) : similarTraits.length > 0 ? (
            <div className="space-y-3">
              {similarTraits.map((simTrait) => (
                <SimilarTraitRow key={simTrait.id} trait={simTrait} />
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">
              No similar traits found.
            </p>
          )}
        </div>
      )}

      {/* Related Tags Tab */}
      {activeTab === 'related-tags' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          {isLoadingTab ? (
            <LoadingTabContent message="Loading related tags..." />
          ) : relatedTags.length > 0 ? (
            <div className="space-y-3">
              {relatedTags.map((tag) => (
                <RelatedTagRow key={tag.id} tag={tag} />
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">
              No related tags found.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CharacterCard({ character }: { character: TraitCharacter }) {
  const { preference } = useTitlePreference();
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <Link
      href={`/character/${character.id}`}
      className="flex gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 shadow-sm hover:shadow-md hover:shadow-gray-200/40 dark:hover:shadow-none transition-all duration-200"
    >
      <div className="w-16 h-20 flex-shrink-0 relative overflow-hidden rounded">
        {/* Shimmer placeholder - visible until image loads */}
        <div className={`absolute inset-0 image-placeholder transition-opacity duration-300 ${imageLoaded ? 'opacity-0' : 'opacity-100'}`} />
        {character.image_url ? (
          <NSFWImage
            src={getProxiedImageUrl(character.image_url)}
            alt={character.name}
            vnId={character.id}
            imageSexual={character.image_sexual}
            className={`w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageLoaded(true)}
          />
        ) : (
          <div className="absolute inset-0 bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
            <Users className="w-6 h-6 text-gray-400" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-gray-900 dark:text-white text-sm truncate">
          {character.name}
        </h4>
        {character.original && (
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {character.original}
          </p>
        )}
        {character.vns.length > 0 && (
          <div className="mt-1">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Appears in:
            </p>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {character.vns.slice(0, 2).map((vn, idx) => {
                const vnDisplayTitle = getDisplayTitle({ title: vn.title, title_jp: vn.title_jp, title_romaji: vn.title_romaji }, preference);
                return (
                  <span
                    key={`${vn.id}-${idx}`}
                    className="px-1.5 py-0.5 text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded truncate max-w-[120px]"
                    title={vnDisplayTitle}
                  >
                    {vnDisplayTitle}
                  </span>
                );
              })}
              {character.vns.length > 2 && (
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  +{character.vns.length - 2} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}

function VNCard({ vn }: { vn: TagVN }) {
  const { preference } = useTitlePreference();
  const [imageLoaded, setImageLoaded] = useState(false);
  const displayTitle = getDisplayTitle({ title: vn.title, title_jp: vn.title_jp || vn.alttitle, title_romaji: vn.title_romaji }, preference);

  return (
    <Link
      href={`/vn/${vn.id}`}
      className="flex gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 shadow-sm hover:shadow-md hover:shadow-gray-200/40 dark:hover:shadow-none transition-all duration-200"
    >
      <div className="w-16 h-20 flex-shrink-0 relative overflow-hidden rounded">
        {/* Shimmer placeholder - visible until image loads */}
        <div className={`absolute inset-0 image-placeholder transition-opacity duration-300 ${imageLoaded ? 'opacity-0' : 'opacity-100'}`} />
        {vn.image_url ? (
          <NSFWImage
            src={getProxiedImageUrl(vn.image_url, { vnId: vn.id })}
            alt={displayTitle}
            vnId={vn.id}
            imageSexual={vn.image_sexual}
            className={`w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageLoaded(true)}
          />
        ) : (
          <div className="absolute inset-0 bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
            <BookOpen className="w-6 h-6 text-gray-400" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-gray-900 dark:text-white text-sm truncate">
          {displayTitle}
        </h4>
        {vn.released && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {vn.released.substring(0, 4)}
          </p>
        )}
        {vn.rating && (
          <div className="flex items-center gap-1 mt-1">
            <Star className="w-3 h-3 text-yellow-500" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {vn.rating.toFixed(2)}
            </span>
            {vn.votecount && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                ({vn.votecount.toLocaleString()})
              </span>
            )}
          </div>
        )}
        {vn.tags && vn.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {sortTagsByWeight(vn.tags).slice(0, 3).map((t) => (
              <span
                key={t.id}
                className="px-1.5 py-0.5 text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded"
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

function SimilarTraitRow({ trait }: { trait: SimilarTraitResult }) {
  const percentage = Math.round(trait.similarity * 100);

  return (
    <Link
      href={`/stats/trait/${trait.id}`}
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Heart className="w-4 h-4 text-pink-500 flex-shrink-0" />
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-gray-900 dark:text-white truncate">{trait.name}</span>
          {trait.group_name && (
            <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 flex-shrink-0">
              {trait.group_name}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-4">
        <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {trait.shared_character_count} shared characters
        </span>
        <div className="w-24 flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-pink-500 rounded-full"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-10 text-right">
            {percentage}%
          </span>
        </div>
      </div>
    </Link>
  );
}

function RelatedTagRow({ tag }: { tag: RelatedTag }) {
  const percentage = Math.round(tag.frequency * 100);

  return (
    <Link
      href={`/stats/tag/${tag.id}`}
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Tags className="w-4 h-4 text-primary-500 flex-shrink-0" />
        <span className="font-medium text-gray-900 dark:text-white truncate">{tag.name}</span>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-4">
        <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {tag.vn_count} VNs
        </span>
        <div className="w-24 flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full"
              style={{ width: `${Math.min(100, percentage)}%` }}
            />
          </div>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-10 text-right">
            {percentage}%
          </span>
        </div>
      </div>
    </Link>
  );
}

function LoadingTabContent({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw className="w-6 h-6 animate-spin text-primary-500" />
      <span className="ml-2 text-gray-500 dark:text-gray-400">{message}</span>
    </div>
  );
}

function ErrorState({ error, traitId }: { error: string | null; traitId: string }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
        <AlertCircle className="w-8 h-8 text-red-500" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Unable to Load Trait
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {error || 'Something went wrong while loading the trait data.'}
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Go Back
        </button>
        <a
          href={`https://vndb.org/i${traitId.replace(/\D/g, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Check on VNDB
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}

function CharacterCardSkeleton() {
  return (
    <div className="flex gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
      {/* Image placeholder */}
      <div className="w-16 h-20 flex-shrink-0 rounded image-placeholder" />
      <div className="flex-1 min-w-0 space-y-2">
        {/* Name */}
        <div className="h-4 w-3/4 rounded image-placeholder" />
        {/* Original name */}
        <div className="h-3 w-1/2 rounded image-placeholder" />
        {/* VN badges */}
        <div className="flex gap-1 mt-2">
          <div className="h-4 w-20 rounded image-placeholder" />
          <div className="h-4 w-16 rounded image-placeholder" />
        </div>
      </div>
    </div>
  );
}

function VNCardSkeleton() {
  return (
    <div className="flex gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
      {/* Image placeholder */}
      <div className="w-16 h-20 flex-shrink-0 rounded image-placeholder" />
      <div className="flex-1 min-w-0 space-y-2">
        {/* Title */}
        <div className="h-4 w-4/5 rounded image-placeholder" />
        {/* Year */}
        <div className="h-3 w-12 rounded image-placeholder" />
        {/* Rating */}
        <div className="h-3 w-20 rounded image-placeholder" />
        {/* Tags */}
        <div className="flex gap-1 mt-2">
          <div className="h-4 w-14 rounded image-placeholder" />
          <div className="h-4 w-12 rounded image-placeholder" />
          <div className="h-4 w-16 rounded image-placeholder" />
        </div>
      </div>
    </div>
  );
}
