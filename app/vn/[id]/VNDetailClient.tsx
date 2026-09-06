'use client';

import { useEffect, useRef, useState, useCallback, useMemo, type ComponentType } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

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
import { VNSidebar, RatingArc } from '@/components/vn/VNSidebar';
import { VNDescription } from '@/components/vn/VNDescription';
import { VNTags } from '@/components/vn/VNTags';
import { VNLanguageSummary } from '@/components/vn/VNLanguageSummary';
import { VNTabs, VNTabId } from '@/components/vn/VNTabs';
import { VNSimilar } from '@/components/vn/VNSimilar';
import { VNContentSimilar } from '@/components/vn/VNContentSimilar';
import { VNRelations } from '@/components/vn/VNRelations';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import JitenLink, { useJitenDeck } from '@/components/vn/JitenLink';
import { VNVoteStats } from '@/components/vn/VNVoteStats';
import type { LanguageLookup } from '@/lib/jiten-server';



function TabContentSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-10 rounded-xs bg-[color:var(--surface-inset)] border border-[color:var(--rule)]"
        />
      ))}
    </div>
  );
}

// ─── Lazy tab components with module-level cache ───
// When a chunk has been prefetched (via idle or hover), the cached module
// renders immediately, no skeleton flash.

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
  /** Measurements read during the server pass; null when the lookup did not resolve. */
  languageLookup?: LanguageLookup | null;
  /**
   * The cast and credits panel, rendered on the server and handed in whole.
   * It carries the page's only links to the people behind a title, so it is mounted with
   * the rest of the page and hidden by CSS rather than waiting for its tab to be opened.
   */
  creditsSlot?: React.ReactNode;
}

const VALID_TABS: VNTabId[] = ['summary', 'language', 'tags', 'traits', 'characters', 'credits', 'stats'];

export default function VNDetailClient({
  vnId,
  initialVN,
  initialCharacters,
  initialSimilar,
  initialJitenDeckId,
  languageLookup = null,
  creditsSlot = null,
}: VNDetailClientProps) {
  // Subscribe to title preference to ensure re-render when user changes language setting
  const { preference } = useTitlePreference();

  // The VN route accepts both `11` and `v11`, but the jiten endpoints only serve the
  // prefixed form, and their cache keys have to match the ones the language tab builds
  // from the API's own prefixed `vn.id`.
  const jitenVnId = vnId.startsWith('v') ? vnId : `v${vnId}`;

  // jiten.moe deck ID lookup (shared with JitenLink header button)
  const clientJitenDeckId = useJitenDeck(initialJitenDeckId !== undefined ? undefined : jitenVnId);
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

  // Ref for tab content container, used to lock height during tab switches
  const tabContentRef = useRef<HTMLDivElement>(null);

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
    const traitData = new Map<string, { spoiler: number; group_name?: string }>();
    for (const char of initialCharacters) {
      for (const trait of char.traits) {
        const existing = traitData.get(trait.id);
        if (!existing || trait.spoiler > existing.spoiler) {
          traitData.set(trait.id, { spoiler: trait.spoiler, group_name: trait.group_name });
        }
      }
    }
    let count = 0;
    for (const [, data] of traitData) {
      if (data.spoiler === 0 && !data.group_name?.includes('(Sexual)')) count++;
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

  // Sexual content toggles (hidden by default, same pattern as spoilers)
  const [showSexualTags, setShowSexualTags] = useState(false);
  const [showSexualTraits, setShowSexualTraits] = useState(false);

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount for deep-links, not on every tab change

  // Vote stats (SWR, pre-fetches on page load, cached across tab switches)
  const {
    data: voteStats,
    error: voteStatsError,
    isLoading: voteStatsLoading,
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
    // Lock container height to prevent layout shift while the old panel
    // collapses (position:absolute) and the new panel renders in.
    const el = tabContentRef.current;
    if (el) el.style.minHeight = `${el.offsetHeight}px`;

    void loadTabModule(newTab);
    setActiveTab(newTab);
    setVisitedTabs(prev => {
      if (prev.has(newTab)) return prev;
      return new Set(prev).add(newTab);
    });
    // Read URL directly to avoid searchParams dependency (which recreates this callback)
    const params = new URLSearchParams(window.location.search);
    if (newTab === 'summary') {
      params.delete('tab');
    } else {
      params.set('tab', newTab);
    }
    const qs = params.toString();
    const newUrl = qs ? `${pathname}?${qs}` : pathname;
    window.history.replaceState(null, '', newUrl);
  }, [pathname, loadTabModule]);

  // Prefetch tab data on hover for faster perceived loading
  const handleTabHover = useCallback((tabId: VNTabId) => {
    if (tabId === 'summary' && !similarData && !similarLoading) {
      void loadSimilarVNs();
    }
    if (tabId === 'language' && jitenDeckId) {
      prefetchJitenData(jitenVnId);
    }
    if (tabId === 'stats') {
      prefetchVoteStats(vnId);
    }
    void loadTabModule(tabId);
  }, [jitenDeckId, jitenVnId, loadSimilarVNs, loadTabModule, similarData, similarLoading, vnId]);

  // Sync tab state when URL changes (back/forward navigation).
  // Depends only on tabFromUrl, NOT activeTab, to avoid a race condition:
  // handleTabChange sets activeTab immediately, but replaceState triggers
  // Next.js to update searchParams asynchronously. If activeTab were in deps,
  // the effect would fire with stale tabFromUrl and "correct" activeTab back.
  useEffect(() => {
    const urlTab = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'summary';
    void loadTabModule(urlTab);
    setActiveTab(urlTab);
    setVisitedTabs(prev => prev.has(urlTab) ? prev : new Set(prev).add(urlTab));
  }, [tabFromUrl, loadTabModule]); // eslint-disable-line react-hooks/exhaustive-deps

  // Release the tab-content height lock after React commits the new panel to the DOM.
  // One rAF waits for the browser to paint, then we clear the inline min-height.
  useEffect(() => {
    const el = tabContentRef.current;
    if (!el || !el.style.minHeight) return;
    const id = requestAnimationFrame(() => { el.style.minHeight = ''; });
    return () => cancelAnimationFrame(id);
  }, [activeTab]);

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
    const wanted = `${getDisplayTitle({ title: vn.title, title_jp: vn.title_jp, title_romaji: vn.title_romaji }, preference)} (Visual Novel) | VN Club`;
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
      // Don't replace the page: VN data is already displayed
    } finally {
      setIsRefreshing(false);
    }
  };

  // Calculate trait count from characters (for tab badge)
  const calculateTraitCount = useCallback((chars: VNCharacter[], spoilers: boolean, sexual: boolean) => {
    const traitData = new Map<string, { spoiler: number; group_name?: string }>();
    for (const char of chars) {
      for (const trait of char.traits) {
        const existing = traitData.get(trait.id);
        if (!existing || trait.spoiler > existing.spoiler) {
          traitData.set(trait.id, { spoiler: trait.spoiler, group_name: trait.group_name });
        }
      }
    }
    let count = 0;
    for (const [, data] of traitData) {
      if ((spoilers || data.spoiler === 0) && (sexual || !data.group_name?.includes('(Sexual)'))) count++;
    }
    return count;
  }, []);

  const loadCharacters = useCallback(async () => {
    setCharactersLoading(true);
    try {
      const chars = await vndbStatsApi.getVNCharacters(vnId);
      setCharacters(chars);
      setCharactersLoaded(true);
      setTraitsReadyCount(calculateTraitCount(chars, showTraitSpoilers, showSexualTraits));
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

  // Recalculate trait count when spoiler or sexual toggle changes
  useEffect(() => {
    if (characters.length > 0) {
      setTraitsReadyCount(calculateTraitCount(characters, showTraitSpoilers, showSexualTraits));
    }
  }, [showTraitSpoilers, showSexualTraits, characters, calculateTraitCount]);

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- preload IDF counts once when server-provided characters are available

  const visibleTagCount = useMemo(() => {
    if (!vn) return undefined;
    return vn.tags?.filter(t => (showTagSpoilers || t.spoiler === 0) && (showSexualTags || t.category !== 'ero')).length;
  }, [showTagSpoilers, showSexualTags, vn]);

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
      // A VN with no deck has nothing to warm, so the request is left unmade.
      if (jitenDeckId) prefetchJitenData(jitenVnId);

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
  }, [vn, vnId, jitenDeckId, jitenVnId]);

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
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[color:var(--ground)]/70 backdrop-blur-xs">
          <div className="vn-sec flex items-center gap-2 px-4 py-2">
            <RefreshCw className="w-4 h-4 animate-spin text-[color:var(--ai)]" />
            <span className="text-sm text-[color:var(--ink)]">Refreshing...</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <button
          onClick={() => window.history.back()}
          className="sec-more"
        >
          <span aria-hidden>←</span>
          Back
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <JitenLink vnId={vn.id} deckId={jitenDeckId} />
          <a
            href={vndbUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="tab"
          >
            <span><span className="hidden sm:inline">View on </span>VNDB</span>
            <span aria-hidden>↗</span>
          </a>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="tab disabled:opacity-50"
            aria-label="Refresh data"
          >
            Refresh
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
        {/* Left column: Cover + Sidebar */}
        <div className="lg:sticky lg:top-20 lg:self-start lg:flex lg:flex-col lg:max-h-[calc(100vh-5rem)] z-10">
          <div className="max-w-[280px] mx-auto lg:max-w-none lg:mx-0 shrink-0">
            <VNCover
              imageUrl={vn.image_url}
              imageSexual={vn.image_sexual}
              title={vn.title}
              vnId={vn.id}
            />
          </div>
          {vn.rating != null && vn.votecount != null && vn.votecount > 0 && (
            <div className="mt-3 shrink-0">
              <RatingArc rating={vn.rating} votecount={vn.votecount} />
            </div>
          )}
          <div className="vn-sec mt-3 p-3 lg:overflow-y-auto lg:min-h-0 scrollbar-hover">
            <VNSidebar
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
        </div>

        {/* Right column: description, tabs and content */}
        <div className="space-y-4 min-w-0">
          {/* Description always visible */}
          <VNDescription description={vn.description} bare />

          {/* Sticky tabs: negative margin + padding extends the frosted background
             upward to cover the space-y-4 gap between this and the previous sibling */}
          <div className="sticky top-16 lg:top-[71px] z-20 -mt-4 pt-4 bg-[color:var(--ground)]">
            <VNTabs
              activeTab={activeTab}
              onTabChange={handleTabChange}
              onTabHover={handleTabHover}
              tagCount={visibleTagCount}
              traitCount={charactersLoaded ? (traitsReadyCount ?? 0) : undefined}
              characterCount={visibleCharacterCount}
              hasCredits={Boolean(creditsSlot)}
            />
          </div>

          {/* Tab Content, lazy-mount / keep-alive: tabs mount on first visit,
             then stay in the DOM (hidden via CSS) for instant re-visits. */}
          <div ref={tabContentRef} className="relative min-h-[400px]">
          <div
            className={activeTab === 'summary' ? 'vn-tabpanel-active' : 'vn-tabpanel-hidden'}
            role="tabpanel"
            id="vn-tabpanel-summary"
            aria-labelledby="vn-tab-summary"
          >
            <div className="space-y-4">
              <VNLanguageSummary
                lookup={languageLookup}
                onOpenAnalysis={() => handleTabChange('language')}
              />
              <VNTags tags={vn.tags} />
              {/* Language filter - applies to relations and similar VNs */}
              {((vn.relations && vn.relations.length > 0) || similarLoading || similarError || (similarData?.content_similar?.length || 0) > 0 || (similarData?.users_also_read?.length || 0) > 0) && (
                <div className="flex items-center justify-end gap-2">
                  <span className="fig-label">Show</span>
                  <button
                    onClick={() => setJapaneseOnly(true)}
                    aria-pressed={japaneseOnly}
                    className={`tab${japaneseOnly ? ' tab--on' : ''}`}
                  >
                    Japanese Only
                  </button>
                  <button
                    onClick={() => setJapaneseOnly(false)}
                    aria-pressed={!japaneseOnly}
                    className={`tab${!japaneseOnly ? ' tab--on' : ''}`}
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
              className={activeTab === 'language' ? 'vn-tabpanel-active' : 'vn-tabpanel-hidden'}
              style={{ contain: 'content' }}
              role="tabpanel"
              id="vn-tabpanel-language"
              aria-labelledby="vn-tab-language"
            >
              {(() => {
                const Comp = LazyVNLanguageStats.get();
                return Comp
                  ? <Comp vnId={vn.id} deckId={jitenDeckId} />
                  : <TabContentSkeleton rows={8} />;
              })()}
            </div>
          )}

          {visitedTabs.has('tags') && (
            <div
              className={activeTab === 'tags' ? 'vn-tabpanel-active' : 'vn-tabpanel-hidden'}
              role="tabpanel"
              id="vn-tabpanel-tags"
              aria-labelledby="vn-tab-tags"
            >
              {(() => {
                const Comp = LazyVNTagsTable.get();
                return Comp
                  ? <Comp tags={vn.tags} showSpoilers={showTagSpoilers} onShowSpoilersChange={setShowTagSpoilers} showSexual={showSexualTags} onShowSexualChange={setShowSexualTags} />
                  : <TabContentSkeleton rows={10} />;
              })()}
            </div>
          )}

          {visitedTabs.has('traits') && (
            <div
              className={activeTab === 'traits' ? 'vn-tabpanel-active' : 'vn-tabpanel-hidden'}
              role="tabpanel"
              id="vn-tabpanel-traits"
              aria-labelledby="vn-tab-traits"
            >
              {(() => {
                const Comp = LazyVNTraits.get();
                return Comp
                  ? <Comp characters={characters} isLoading={charactersLoading} globalCounts={globalTraitCounts} showSpoilers={showTraitSpoilers} onShowSpoilersChange={setShowTraitSpoilers} showSexual={showSexualTraits} onShowSexualChange={setShowSexualTraits} />
                  : <TabContentSkeleton rows={12} />;
              })()}
            </div>
          )}

          {visitedTabs.has('characters') && (
            <div
              className={activeTab === 'characters' ? 'vn-tabpanel-active' : 'vn-tabpanel-hidden'}
              role="tabpanel"
              id="vn-tabpanel-characters"
              aria-labelledby="vn-tab-characters"
            >
              {(() => {
                const Comp = LazyVNCharacters.get();
                return Comp
                  ? <Comp characters={characters} isLoading={charactersLoading} showSpoilers={showCharacterSpoilers} onShowSpoilersChange={setShowCharacterSpoilers} showSexual={showSexualTraits} onShowSexualChange={setShowSexualTraits} />
                  : <TabContentSkeleton rows={8} />;
              })()}
            </div>
          )}

          {/* Not gated on having been visited, unlike its neighbours. The panel is server
              rendered and holds this page's only links to the characters, staff and voice
              actors behind the title, so it belongs in the delivered markup whether or not
              anyone opens the tab. */}
          {creditsSlot && (
            <div
              className={activeTab === 'credits' ? 'vn-tabpanel-active' : 'vn-tabpanel-hidden'}
              role="tabpanel"
              id="vn-tabpanel-credits"
              aria-labelledby="vn-tab-credits"
            >
              {creditsSlot}
            </div>
          )}

          {visitedTabs.has('stats') && (
            <div
              className={activeTab === 'stats' ? 'vn-tabpanel-active' : 'vn-tabpanel-hidden'}
              style={{ contain: 'content' }}
              role="tabpanel"
              id="vn-tabpanel-stats"
              aria-labelledby="vn-tab-stats"
            >
              <VNVoteStats
                data={voteStats ?? null}
                isLoading={voteStatsLoading}
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
        <div className="w-16 h-8 rounded-xs image-placeholder" />
        <div className="flex items-center gap-2">
          <div className="w-28 h-9 rounded-xs image-placeholder" />
          <div className="w-20 h-9 rounded-xs image-placeholder" />
        </div>
      </div>
      {/* Title skeleton */}
      <div className="mb-4">
        <div className="w-3/4 h-7 rounded-xs image-placeholder" />
        <div className="w-1/2 h-5 rounded-xs image-placeholder mt-1.5" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 lg:gap-8">
        {/* Left column: cover + sidebar */}
        <div>
          <div className="aspect-3/4 max-w-[280px] mx-auto lg:mx-0 rounded-[1px] image-placeholder" />
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-[52px] h-[52px] rounded-xs image-placeholder" />
              <div className="space-y-1">
                <div className="w-20 h-3.5 rounded-xs image-placeholder" />
                <div className="w-16 h-3 rounded-xs image-placeholder" />
              </div>
            </div>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i}>
                <div className="w-16 h-3 rounded-xs image-placeholder mb-1" />
                <div className="h-4 rounded-xs image-placeholder" style={{ width: `${60 + i * 15}px` }} />
              </div>
            ))}
          </div>
        </div>
        {/* Right column: description + tabs + content */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="h-4 w-full rounded-xs image-placeholder" />
            <div className="h-4 w-full rounded-xs image-placeholder" />
            <div className="h-4 w-3/4 rounded-xs image-placeholder" />
          </div>
          <div className="flex gap-1 border-b border-[color:var(--rule)] pb-1">
            {['Overview', 'Stats', 'Language', 'Tags', 'Traits', 'Characters'].map((tab) => (
              <div
                key={tab}
                className="h-7 rounded-xs image-placeholder"
                style={{ width: `${tab.length * 9 + 24}px` }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div
                key={i}
                className="h-6 rounded-xs image-placeholder"
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
      <span className="nameplate">Not loaded</span>
      <h1 className="font-display text-2xl font-bold text-[color:var(--ink)] mt-4 mb-2">
        Unable to Load Visual Novel
      </h1>
      <p className="text-[color:var(--nezu)] mb-6">
        {error || 'Something went wrong while loading the visual novel.'}
      </p>
      <div className="tabs justify-center">
        {onRetry && (
          <button onClick={onRetry} className="tab">
            Try Again
          </button>
        )}
        <button onClick={() => window.history.back()} className="tab">
          <span aria-hidden>←</span>
          Go Back
        </button>
        <a
          href={vndbUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="tab"
        >
          Try on VNDB
          <span aria-hidden>↗</span>
        </a>
      </div>
    </div>
  );
}
