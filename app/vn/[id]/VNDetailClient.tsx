'use client';

import { useEffect, useState, useCallback, useMemo, startTransition, type ComponentType } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import { ArrowLeft, ExternalLink, AlertCircle, RefreshCw, Globe } from 'lucide-react';

import {
  vndbStatsApi,
  VNDetail,
  VNCharacter,
  SimilarVNsResponse,
  getVNDBUrl,
} from '@/lib/vndb-stats-api';
import { useVNVoteStats, prefetchVoteStats } from '@/lib/vndb-stats-cached';
import { prefetchJitenData } from '@/lib/jiten-hooks';
import { VNCover } from '@/components/vn/VNCover';
import { VNTitle } from '@/components/vn/VNTitle';
import { VNSidebar } from '@/components/vn/VNSidebar';
import { VNDescription } from '@/components/vn/VNDescription';
import { VNTags } from '@/components/vn/VNTags';
import { VNTabs, VNTabId } from '@/components/vn/VNTabs';
import { VNSimilar } from '@/components/vn/VNSimilar';
import { VNContentSimilar } from '@/components/vn/VNContentSimilar';
import { VNRelations } from '@/components/vn/VNRelations';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import JitenLink, { useJitenDeck } from '@/components/vn/JitenLink';
import { VNVoteStats } from '@/components/vn/VNVoteStats';



function TabContentSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-10 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700/80"
        />
      ))}
    </div>
  );
}

// ─── Lazy tab components with module-level cache ───
// When a chunk has been prefetched (via idle or hover), the cached module
// renders immediately — no skeleton flash.

function lazyTab<P extends Record<string, unknown>>(
  loader: () => Promise<Record<string, unknown>>,
  exportName: string,
) {
  let current: ComponentType<P> | null = null;
  let promise: Promise<void> | null = null;
  return {
    load() {
      if (!promise) {
        promise = loader()
          .then(m => { current = m[exportName] as ComponentType<P>; })
          .catch(() => { promise = null; });
      }
      return promise;
    },
    get: () => current,
  };
}

const LazyVNLanguageStats = lazyTab(
  () => import('@/components/vn/VNLanguageStats') as Promise<Record<string, unknown>>,
  'VNLanguageStats',
);
const LazyVNTagsTable = lazyTab(
  () => import('@/components/vn/VNTagsTable') as Promise<Record<string, unknown>>,
  'VNTagsTable',
);
const LazyVNTraits = lazyTab(
  () => import('@/components/vn/VNTraits') as Promise<Record<string, unknown>>,
  'VNTraits',
);
const LazyVNCharacters = lazyTab(
  () => import('@/components/vn/VNCharacters') as Promise<Record<string, unknown>>,
  'VNCharacters',
);

interface VNDetailClientProps {
  vnId: string;
  initialVN: VNDetail | null;
  initialCharacters?: VNCharacter[] | null;
  initialSimilar?: SimilarVNsResponse | null;
  initialJitenDeckId?: number | null;
}

const VALID_TABS: VNTabId[] = ['summary', 'language', 'tags', 'traits', 'characters', 'stats'];

export default function VNDetailClient({
  vnId,
  initialVN,
  initialCharacters,
  initialSimilar,
  initialJitenDeckId,
}: VNDetailClientProps) {
  // Subscribe to title preference to ensure re-render when user changes language setting
  const { preference } = useTitlePreference();

  // jiten.moe deck ID lookup (shared with JitenLink header button)
  const clientJitenDeckId = useJitenDeck(initialJitenDeckId !== undefined ? undefined : vnId);
  const jitenDeckId = initialJitenDeckId !== undefined ? initialJitenDeckId : clientJitenDeckId;

  // URL-based tab state
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const tabFromUrl = searchParams.get('tab') as VNTabId | null;

  const [vn, setVN] = useState<VNDetail | null>(initialVN);
  const [isLoading, setIsLoading] = useState(!initialVN);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab state - initialize from URL
  const initialTab = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'summary';
  const [activeTab, setActiveTab] = useState<VNTabId>(initialTab);

  // Track which tabs have been visited so we can lazy-mount but keep-alive
  const [visitedTabs, setVisitedTabs] = useState<Set<VNTabId>>(() => new Set([initialTab]));

  // Similar VNs
  const [similarData, setSimilarData] = useState<SimilarVNsResponse | null>(initialSimilar ?? null);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarError, setSimilarError] = useState(false);

  // Characters/Traits
  const [characters, setCharacters] = useState<VNCharacter[]>(initialCharacters ?? []);
  const [charactersLoading, setCharactersLoading] = useState(false);
  const [charactersLoaded, setCharactersLoaded] = useState(!!initialCharacters);
  const [traitsReadyCount, setTraitsReadyCount] = useState<number | undefined>(() => {
    if (!initialCharacters || initialCharacters.length === 0) return undefined;
    const traitMaxSpoiler = new Map<string, number>();
    for (const char of initialCharacters) {
      for (const trait of char.traits) {
        const existing = traitMaxSpoiler.get(trait.id) ?? 0;
        traitMaxSpoiler.set(trait.id, Math.max(existing, trait.spoiler));
      }
    }
    let count = 0;
    for (const [, spoiler] of traitMaxSpoiler) {
      if (spoiler === 0) count++;
    }
    return count;
  });
  const [globalTraitCounts, setGlobalTraitCounts] = useState<{ counts: Record<string, number>; total_characters: number } | null>(null);

  // Language filter for similar VNs (default to Japanese only)
  const [japaneseOnly, setJapaneseOnly] = useState(true);

  // Spoiler toggles (lifted up so tab counts match content)
  const [showTagSpoilers, setShowTagSpoilers] = useState(false);
  const [showTraitSpoilers, setShowTraitSpoilers] = useState(false);
  const [showCharacterSpoilers, setShowCharacterSpoilers] = useState(false);

  // Tracks which lazy tab modules have loaded (triggers re-render)
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (LazyVNLanguageStats.get()) initial.add('language');
    if (LazyVNTagsTable.get()) initial.add('tags');
    if (LazyVNTraits.get()) initial.add('traits');
    if (LazyVNCharacters.get()) initial.add('characters');
    return initial;
  });

  const loadTabModule = useCallback(async (tabId: VNTabId) => {
    const loaders: Record<string, { load: () => Promise<void> }> = {
      language: LazyVNLanguageStats,
      tags: LazyVNTagsTable,
      traits: LazyVNTraits,
      characters: LazyVNCharacters,
    };
    const loader = loaders[tabId];
    if (loader) {
      await loader.load();
      setLoadedTabs(prev => {
        if (prev.has(tabId)) return prev;
        return new Set(prev).add(tabId);
      });
    }
  }, []);

  // Load the lazy module for the initial active tab (handles deep-links like ?tab=language
  // and Suspense re-mounts where the tab state comes from the URL, not a click)
  useEffect(() => {
    void loadTabModule(activeTab);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — run once on mount for deep-links, not on every tab change

  // Vote stats (SWR — pre-fetches on page load, cached across tab switches)
  const {
    data: voteStats,
    error: voteStatsError,
  } = useVNVoteStats(vnId);

  const loadSimilarVNs = useCallback(async () => {
    setSimilarLoading(true);
    setSimilarError(false);
    try {
      const result = await vndbStatsApi.getSimilarVNs(vnId, 10);
      setSimilarData(result);
    } catch {
      setSimilarError(true);
    } finally {
      setSimilarLoading(false);
    }
  }, [vnId]);

  // Handle tab change - update URL without triggering RSC re-render
  const handleTabChange = useCallback((newTab: VNTabId) => {
    void loadTabModule(newTab);
    startTransition(() => {
      setActiveTab(newTab);
      setVisitedTabs(prev => {
        if (prev.has(newTab)) return prev;
        return new Set(prev).add(newTab);
      });
    });
    const params = new URLSearchParams(searchParams.toString());
    if (newTab === 'summary') {
      params.delete('tab');
    } else {
      params.set('tab', newTab);
    }
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    window.history.replaceState(null, '', newUrl);
  }, [pathname, searchParams, loadTabModule]);

  // Prefetch tab data on hover for faster perceived loading
  const handleTabHover = useCallback((tabId: VNTabId) => {
    if (tabId === 'summary' && !similarData && !similarLoading) {
      void loadSimilarVNs();
    }
    if (tabId === 'language' && jitenDeckId) {
      prefetchJitenData(vnId);
    }
    if (tabId === 'stats') {
      prefetchVoteStats(vnId);
    }
    void loadTabModule(tabId);
  }, [jitenDeckId, loadSimilarVNs, loadTabModule, similarData, similarLoading, vnId]);

  // Sync tab state when URL changes (back/forward navigation)
  useEffect(() => {
    const urlTab = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'summary';
    if (urlTab !== activeTab) {
      setActiveTab(urlTab);
      setVisitedTabs(prev => {
        if (prev.has(urlTab)) return prev;
        return new Set(prev).add(urlTab);
      });
    }
  }, [activeTab, tabFromUrl]);

  const loadVN = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const vnData = await vndbStatsApi.getVN(vnId);
      if (vnData) {
        setVN(vnData);
      } else {
        setError('Visual novel not found.');
      }
    } catch {
      setError('Failed to load visual novel data.');
    } finally {
      setIsLoading(false);
    }
  }, [vnId]);

  useEffect(() => {
    if (!initialVN) {
      void loadVN();
    } else {
      setVN(initialVN);
      setSimilarData(initialSimilar ?? null);
      setSimilarLoading(false);
      setCharacters(initialCharacters ?? []);
      setCharactersLoaded(!!initialCharacters);
      setCharactersLoading(false);
      setGlobalTraitCounts(null);
      // Load similar VNs client-side if not provided by server
      if (!initialSimilar) void loadSimilarVNs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadSimilarVNs only depends on vnId (stable prop)
  }, [initialVN, initialCharacters, initialSimilar, loadVN]);

  // Override document title based on user preference.
  useEffect(() => {
    if (!vn) return;
    const wanted = `${getDisplayTitle({ title: vn.title, title_jp: vn.title_jp, title_romaji: vn.title_romaji }, preference)} | VN Club`;
    document.title = wanted;

    const observer = new MutationObserver(() => {
      if (document.title !== wanted) document.title = wanted;
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [vn, preference]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setError(null);

    try {
      const vnData = await vndbStatsApi.getVN(vnId);
      if (vnData) {
        setVN(vnData);
        setSimilarData(null);
        setSimilarLoading(false);
        setCharacters([]);
        setCharactersLoaded(false);
        setCharactersLoading(false);
        setGlobalTraitCounts(null);
      }
    } catch {
      // Don't replace the page — VN data is already displayed
    } finally {
      setIsRefreshing(false);
    }
  };

  // Calculate trait count from characters (for tab badge)
  const calculateTraitCount = useCallback((chars: VNCharacter[], spoilers: boolean) => {
    const traitMaxSpoiler = new Map<string, number>();
    for (const char of chars) {
      for (const trait of char.traits) {
        const existing = traitMaxSpoiler.get(trait.id) ?? 0;
        traitMaxSpoiler.set(trait.id, Math.max(existing, trait.spoiler));
      }
    }
    let count = 0;
    for (const [, spoiler] of traitMaxSpoiler) {
      if (spoilers || spoiler === 0) count++;
    }
    return count;
  }, []);

  const loadCharacters = useCallback(async () => {
    setCharactersLoading(true);
    try {
      const chars = await vndbStatsApi.getVNCharacters(vnId);
      setCharacters(chars);
      setCharactersLoaded(true);
      setTraitsReadyCount(calculateTraitCount(chars, showTraitSpoilers));
      const traitIds = new Set<string>();
      for (const char of chars) {
        for (const trait of char.traits) {
          traitIds.add(trait.id);
        }
      }
      if (traitIds.size > 0) {
        vndbStatsApi.getTraitCounts(Array.from(traitIds))
          .then(setGlobalTraitCounts)
          .catch(() => {});
      }
    } catch {
      // Characters are optional, silently fail
    } finally {
      setCharactersLoading(false);
    }
  }, [calculateTraitCount, showTraitSpoilers, vnId]);

  // Load characters when VN is loaded (for trait count in tab badge)
  useEffect(() => {
    if (vn && !charactersLoaded && !charactersLoading) {
      void loadCharacters();
    }
  }, [charactersLoaded, charactersLoading, loadCharacters, vn]);

  // Recalculate trait count when spoiler toggle changes
  useEffect(() => {
    if (characters.length > 0) {
      setTraitsReadyCount(calculateTraitCount(characters, showTraitSpoilers));
    }
  }, [showTraitSpoilers, characters, calculateTraitCount]);

  // Preload global trait counts when server-provided characters are available
  useEffect(() => {
    if (initialCharacters && initialCharacters.length > 0 && !globalTraitCounts) {
      const traitIds = new Set<string>();
      for (const char of initialCharacters) {
        for (const trait of char.traits) {
          traitIds.add(trait.id);
        }
      }
      if (traitIds.size > 0) {
        vndbStatsApi.getTraitCounts(Array.from(traitIds))
          .then(setGlobalTraitCounts)
          .catch(() => {});
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — preload IDF counts once when server-provided characters are available

  const visibleTagCount = useMemo(() => {
    if (!vn) return undefined;
    return vn.tags?.filter(t => showTagSpoilers || t.spoiler === 0).length;
  }, [showTagSpoilers, vn]);

  const visibleCharacterCount = useMemo(() => {
    if (!charactersLoaded) return undefined;
    return characters.filter(c => showCharacterSpoilers || (c.spoiler ?? 0) === 0).length;
  }, [characters, charactersLoaded, showCharacterSpoilers]);

  useEffect(() => {
    if (!vn) return;

    const schedule = typeof requestIdleCallback !== 'undefined'
      ? (cb: () => void) => requestIdleCallback(cb, { timeout: 2000 })
      : (cb: () => void) => window.setTimeout(cb, 150);

    const cancel = typeof cancelIdleCallback !== 'undefined'
      ? cancelIdleCallback
      : clearTimeout;

    const id = schedule(() => {
      prefetchVoteStats(vnId);
      prefetchJitenData(vnId);

      Promise.all([
        LazyVNTagsTable.load(),
        LazyVNTraits.load(),
        LazyVNCharacters.load(),
      ]).then(() => {
        setLoadedTabs(prev => {
          const next = new Set(prev);
          if (LazyVNTagsTable.get()) next.add('tags');
          if (LazyVNTraits.get()) next.add('traits');
          if (LazyVNCharacters.get()) next.add('characters');
          return next.size === prev.size ? prev : next;
        });
      });
    });

    return () => cancel(id);
  }, [vn, vnId]);

  if (isLoading) {
    return <LoadingState />;
  }

  if (error || !vn) {
    return <ErrorState error={error} vnId={vnId} onRetry={loadVN} />;
  }

  const vndbUrl = getVNDBUrl(vn.id);

  return (
    <div className="relative max-w-6xl mx-auto px-4 pt-6 pb-12">
      {isRefreshing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-gray-800 shadow border border-gray-200 dark:border-gray-700">
            <RefreshCw className="w-4 h-4 animate-spin text-primary-500" />
            <span className="text-sm text-gray-700 dark:text-gray-200">Refreshing...</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors flex-shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="hidden sm:inline text-sm">Back</span>
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          <JitenLink vnId={vn.id} deckId={jitenDeckId} />
          <a
            href={vndbUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <span className="hidden sm:inline">View on </span>VNDB
            <ExternalLink className="w-4 h-4" />
          </a>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
            aria-label="Refresh data"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Title above grid */}
      <div className="mb-4">
        <VNTitle
          title={vn.title}
          titleJp={vn.title_jp}
          titleRomaji={vn.title_romaji}
          olang={vn.olang}
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 lg:gap-8">
        {/* Left column — Cover + Sidebar */}
        <div className="lg:sticky lg:top-20 lg:self-start z-10">
          <div className="max-w-[280px] mx-auto lg:max-w-none lg:mx-0">
            <VNCover
              imageUrl={vn.image_url}
              imageSexual={vn.image_sexual}
              title={vn.title}
              vnId={vn.id}
            />
          </div>
          <VNSidebar
            rating={vn.rating}
            votecount={vn.votecount}
            developers={vn.developers}
            released={vn.released}
            length={vn.length}
            platforms={vn.platforms}
            languages={vn.languages}
            updatedAt={vn.updated_at}
            links={vn.links}
            shops={vn.shops}
          />
        </div>

        {/* Right column — Description + Tabs + Content */}
        <div className="space-y-4 min-w-0">
          {/* Description always visible */}
          <VNDescription description={vn.description} bare />

          {/* Sticky tabs — negative margin + padding extends the frosted background
             upward to cover the space-y-4 gap between this and the previous sibling */}
          <div className="sticky top-16 md:top-[71px] z-20 -mt-4 pt-4 bg-white dark:bg-[color:var(--background)]">
            <VNTabs
              activeTab={activeTab}
              onTabChange={handleTabChange}
              onTabHover={handleTabHover}
              tagCount={visibleTagCount}
              traitCount={charactersLoaded ? (traitsReadyCount ?? 0) : undefined}
              characterCount={visibleCharacterCount}
            />
          </div>

          {/* Tab Content — lazy-mount / keep-alive: tabs mount on first visit,
             then stay in the DOM (hidden via CSS) for instant re-visits. */}
          <div className="min-h-[400px]">
          <div
            style={{ display: activeTab === 'summary' ? undefined : 'none' }}
            role="tabpanel"
            id="vn-tabpanel-summary"
            aria-labelledby="vn-tab-summary"
          >
            <div className="space-y-4">
              <VNTags tags={vn.tags} />
              {/* Language filter - applies to relations and similar VNs */}
              {((vn.relations && vn.relations.length > 0) || similarLoading || similarError || (similarData?.content_similar?.length || 0) > 0 || (similarData?.users_also_read?.length || 0) > 0) && (
                <div className="flex items-center justify-end gap-2 text-sm">
                  <Globe className="w-4 h-4 text-gray-500" />
                  <span className="text-gray-600 dark:text-gray-400">Show:</span>
                  <button
                    onClick={() => setJapaneseOnly(true)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      japaneseOnly
                        ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    Japanese Only
                  </button>
                  <button
                    onClick={() => setJapaneseOnly(false)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      !japaneseOnly
                        ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    All Languages
                  </button>
                </div>
              )}
              <VNRelations relations={(vn.relations || []).filter(
                r => !japaneseOnly || r.olang === 'ja'
              )} />
              <VNContentSimilar
                similar={(similarData?.content_similar || []).filter(
                  vn => !japaneseOnly || vn.olang === 'ja'
                )}
                isLoading={similarLoading}
                error={similarError}
              />
              <VNSimilar
                similar={(similarData?.users_also_read || []).filter(
                  vn => !japaneseOnly || vn.olang === 'ja'
                )}
                isLoading={similarLoading}
                error={similarError}
              />
            </div>
          </div>

          {visitedTabs.has('language') && (
            <div
              style={{ display: activeTab === 'language' ? undefined : 'none', contain: 'content' }}
              role="tabpanel"
              id="vn-tabpanel-language"
              aria-labelledby="vn-tab-language"
            >
              {(() => {
                const Comp = LazyVNLanguageStats.get();
                return Comp
                  ? <Comp vnId={vn.id} deckId={jitenDeckId ?? undefined} />
                  : <TabContentSkeleton rows={8} />;
              })()}
            </div>
          )}

          {visitedTabs.has('tags') && (
            <div
              style={{ display: activeTab === 'tags' ? undefined : 'none' }}
              role="tabpanel"
              id="vn-tabpanel-tags"
              aria-labelledby="vn-tab-tags"
            >
              {(() => {
                const Comp = LazyVNTagsTable.get();
                return Comp
                  ? <Comp tags={vn.tags} showSpoilers={showTagSpoilers} onShowSpoilersChange={setShowTagSpoilers} />
                  : <TabContentSkeleton rows={10} />;
              })()}
            </div>
          )}

          {visitedTabs.has('traits') && (
            <div
              style={{ display: activeTab === 'traits' ? undefined : 'none' }}
              role="tabpanel"
              id="vn-tabpanel-traits"
              aria-labelledby="vn-tab-traits"
            >
              {(() => {
                const Comp = LazyVNTraits.get();
                return Comp
                  ? <Comp characters={characters} isLoading={charactersLoading} globalCounts={globalTraitCounts} showSpoilers={showTraitSpoilers} onShowSpoilersChange={setShowTraitSpoilers} />
                  : <TabContentSkeleton rows={12} />;
              })()}
            </div>
          )}

          {visitedTabs.has('characters') && (
            <div
              style={{ display: activeTab === 'characters' ? undefined : 'none' }}
              role="tabpanel"
              id="vn-tabpanel-characters"
              aria-labelledby="vn-tab-characters"
            >
              {(() => {
                const Comp = LazyVNCharacters.get();
                return Comp
                  ? <Comp characters={characters} isLoading={charactersLoading} showSpoilers={showCharacterSpoilers} onShowSpoilersChange={setShowCharacterSpoilers} />
                  : <TabContentSkeleton rows={8} />;
              })()}
            </div>
          )}

          {visitedTabs.has('stats') && (
            <div
              style={{ display: activeTab === 'stats' ? undefined : 'none', contain: 'content' }}
              role="tabpanel"
              id="vn-tabpanel-stats"
              aria-labelledby="vn-tab-stats"
            >
              <VNVoteStats
                data={voteStats ?? null}
                isLoading={!voteStats && !voteStatsError}
                error={!!voteStatsError}
                totalVotecount={vn.votecount}
                vnRating={vn.rating}
              />
            </div>
          )}
          </div>

          {/* VNDB Attribution */}
          <VNDBAttribution />
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="max-w-6xl mx-auto px-4 pt-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-4">
        <div className="w-16 h-8 rounded-lg image-placeholder" />
        <div className="flex items-center gap-2">
          <div className="w-28 h-9 rounded-lg image-placeholder" />
          <div className="w-20 h-9 rounded-lg image-placeholder" />
        </div>
      </div>
      {/* Title skeleton */}
      <div className="mb-4">
        <div className="w-3/4 h-7 rounded image-placeholder" />
        <div className="w-1/2 h-5 rounded image-placeholder mt-1.5" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 lg:gap-8">
        {/* Left column: cover + sidebar */}
        <div>
          <div className="aspect-[3/4] max-w-[280px] mx-auto lg:mx-0 rounded-xl image-placeholder" />
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-[52px] h-[52px] rounded-full image-placeholder" />
              <div className="space-y-1">
                <div className="w-20 h-3.5 rounded image-placeholder" />
                <div className="w-16 h-3 rounded image-placeholder" />
              </div>
            </div>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i}>
                <div className="w-16 h-3 rounded image-placeholder mb-1" />
                <div className="h-4 rounded image-placeholder" style={{ width: `${60 + i * 15}px` }} />
              </div>
            ))}
          </div>
        </div>
        {/* Right column: description + tabs + content */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="h-4 w-full rounded image-placeholder" />
            <div className="h-4 w-full rounded image-placeholder" />
            <div className="h-4 w-3/4 rounded image-placeholder" />
          </div>
          <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 pb-1">
            {['Overview', 'Stats', 'Language', 'Tags', 'Traits', 'Characters'].map((tab) => (
              <div
                key={tab}
                className="h-7 rounded-lg image-placeholder"
                style={{ width: `${tab.length * 9 + 24}px` }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div
                key={i}
                className="h-6 rounded-full image-placeholder"
                style={{ width: `${55 + (i % 3) * 18}px` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorState({ error, vnId, onRetry }: { error: string | null; vnId: string; onRetry?: () => void }) {
  const vndbUrl = getVNDBUrl(vnId.startsWith('v') ? vnId : `v${vnId}`);

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
        <AlertCircle className="w-8 h-8 text-red-500" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Unable to Load Visual Novel
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {error || 'Something went wrong while loading the visual novel.'}
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        )}
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Go Back
        </button>
        <a
          href={vndbUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Try on VNDB
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
