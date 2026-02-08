'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, AlertCircle, RefreshCw, Globe } from 'lucide-react';
import {
  vndbStatsApi,
  VNDetail,
  VNCharacter,
  SimilarVNsResponse,
  getVNDBUrl,
} from '@/lib/vndb-stats-api';
import { VNCover } from '@/components/vn/VNCover';
import { VNMetadata } from '@/components/vn/VNMetadata';
import { VNDescription } from '@/components/vn/VNDescription';
import { VNTags } from '@/components/vn/VNTags';
import { VNTabs, VNTabId } from '@/components/vn/VNTabs';
import { VNSimilar } from '@/components/vn/VNSimilar';
import { VNContentSimilar } from '@/components/vn/VNContentSimilar';
import { VNRelations } from '@/components/vn/VNRelations';
import { VNTagsTable } from '@/components/vn/VNTagsTable';
import { VNTraits } from '@/components/vn/VNTraits';
import { VNCharacters } from '@/components/vn/VNCharacters';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { FadeIn } from '@/components/FadeIn';

interface VNDetailClientProps {
  vnId: string;
  initialVN: VNDetail | null;
}

const VALID_TABS: VNTabId[] = ['summary', 'tags', 'traits', 'characters'];

export default function VNDetailClient({ vnId, initialVN }: VNDetailClientProps) {
  // Subscribe to title preference to ensure re-render when user changes language setting
  const { preference } = useTitlePreference();

  // URL-based tab state
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const tabFromUrl = searchParams.get('tab') as VNTabId | null;

  const [vn, setVN] = useState<VNDetail | null>(initialVN);
  const [isLoading, setIsLoading] = useState(!initialVN);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab state - initialize from URL
  const [activeTab, setActiveTab] = useState<VNTabId>(
    tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'summary'
  );

  // Similar VNs
  const [similarData, setSimilarData] = useState<SimilarVNsResponse | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);

  // Characters/Traits
  const [characters, setCharacters] = useState<VNCharacter[]>([]);
  const [charactersLoading, setCharactersLoading] = useState(false);
  const [charactersLoaded, setCharactersLoaded] = useState(false);
  const [traitsReadyCount, setTraitsReadyCount] = useState<number | undefined>(undefined);

  // Language filter for similar VNs (default to Japanese only)
  const [japaneseOnly, setJapaneseOnly] = useState(true);

  // Spoiler toggles (lifted up so tab counts match content)
  const [showTagSpoilers, setShowTagSpoilers] = useState(false);
  const [showTraitSpoilers, setShowTraitSpoilers] = useState(false);
  const [showCharacterSpoilers, setShowCharacterSpoilers] = useState(false);

  // Handle tab change - update URL without triggering RSC re-render
  const handleTabChange = useCallback((newTab: VNTabId) => {
    setActiveTab(newTab);
    const params = new URLSearchParams(searchParams.toString());
    if (newTab === 'summary') {
      params.delete('tab'); // Clean URL for default tab
    } else {
      params.set('tab', newTab);
    }
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    // Use history.replaceState to avoid Next.js RSC re-render that resets component state
    window.history.replaceState(null, '', newUrl);
  }, [pathname, searchParams]);

  // Sync tab state when URL changes (back/forward navigation)
  useEffect(() => {
    const urlTab = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'summary';
    if (urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
  }, [tabFromUrl]);

  useEffect(() => {
    if (!initialVN) {
      loadVN();
    } else {
      // Server provided VN data - sync state and set title
      setVN(initialVN);
      setSimilarData(null);
      setSimilarLoading(false);
      setCharacters([]);
      setCharactersLoaded(false);
      setCharactersLoading(false);
      const title = getDisplayTitle({ title: initialVN.title, title_jp: initialVN.title_jp, title_romaji: initialVN.title_romaji }, preference);
      document.title = `${title} | VN Club`;
    }
  }, [vnId, initialVN]);

  // Load similar VNs when on summary tab
  useEffect(() => {
    if (vn && activeTab === 'summary' && !similarData && !similarLoading) {
      loadSimilarVNs();
    }
  }, [vn, activeTab]);

  // Load characters when VN is loaded (for trait count in tab badge)
  useEffect(() => {
    if (vn && !charactersLoaded && !charactersLoading) {
      loadCharacters();
    }
  }, [vn, charactersLoaded]);

  // Update document title when preference changes (for client-side navigation)
  useEffect(() => {
    if (vn) {
      const title = getDisplayTitle({ title: vn.title, title_jp: vn.title_jp, title_romaji: vn.title_romaji }, preference);
      document.title = `${title} | VN Club`;
    }
  }, [vn, preference]);

  const loadVN = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const vnData = await vndbStatsApi.getVN(vnId);
      if (vnData) {
        setVN(vnData);
        // Immediately update title to avoid relying on useEffect timing
        const title = getDisplayTitle({ title: vnData.title, title_jp: vnData.title_jp, title_romaji: vnData.title_romaji }, preference);
        document.title = `${title} | VN Club`;
      } else {
        setError('Visual novel not found.');
      }
    } catch {
      setError('Failed to load visual novel data.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setError(null);

    try {
      // Refresh from VNDB API and update database
      const vnData = await vndbStatsApi.refreshVN(vnId);
      if (vnData) {
        setVN(vnData);
      } else {
        setError('Visual novel not found.');
      }
    } catch {
      setError('Failed to refresh visual novel data.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const loadSimilarVNs = async () => {
    setSimilarLoading(true);
    try {
      const result = await vndbStatsApi.getSimilarVNs(vnId, 10);
      if (result) {
        setSimilarData(result);
      }
    } catch {
      // Similar VNs are optional, silently fail
    } finally {
      setSimilarLoading(false);
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

  const loadCharacters = async () => {
    setCharactersLoading(true);
    try {
      const chars = await vndbStatsApi.getVNCharacters(vnId);
      setCharacters(chars);
      setCharactersLoaded(true);
      // Calculate trait count immediately for tab badge
      setTraitsReadyCount(calculateTraitCount(chars, showTraitSpoilers));
    } catch {
      // Characters are optional, silently fail
    } finally {
      setCharactersLoading(false);
    }
  };

  // Recalculate trait count when spoiler toggle changes
  useEffect(() => {
    if (characters.length > 0) {
      setTraitsReadyCount(calculateTraitCount(characters, showTraitSpoilers));
    }
  }, [showTraitSpoilers, characters, calculateTraitCount]);

  // Handle traits ready callback from VNTraits (includes IDF loading) - kept for compatibility
  const handleTraitsReady = (count: number) => {
    setTraitsReadyCount(count);
  };

  if (isLoading) {
    return <LoadingState />;
  }

  if (error || !vn) {
    return <ErrorState error={error} vnId={vnId} onRetry={loadVN} />;
  }

  const vndbUrl = getVNDBUrl(vn.id);

  return (
    <div className="relative max-w-6xl mx-auto px-4 pt-8 overflow-x-hidden">
      {isRefreshing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-gray-800 shadow border border-gray-200 dark:border-gray-700">
            <RefreshCw className="w-4 h-4 animate-spin text-primary-500" />
            <span className="text-sm text-gray-700 dark:text-gray-200">Refreshing…</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-6">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors flex-shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="hidden sm:inline">Back</span>
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={vndbUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            View on VNDB
            <ExternalLink className="w-4 h-4" />
          </a>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
        {/* Left column - Cover */}
        <div className="lg:sticky lg:top-20 lg:self-start z-10">
          <VNCover
            imageUrl={vn.image_url}
            imageSexual={vn.image_sexual}
            title={vn.title}
            rating={vn.rating}
            votecount={vn.votecount}
            vnId={vn.id}
          />
        </div>

        {/* Right column - Details with Tabs */}
        <div className="space-y-6">
          {/* Metadata (always visible) */}
          <VNMetadata
            title={vn.title}
            titleJp={vn.title_jp}
            titleRomaji={vn.title_romaji}
            olang={vn.olang}
            developers={vn.developers}
            released={vn.released}
            length={vn.length}
            platforms={vn.platforms}
            languages={vn.languages}
            updatedAt={vn.updated_at}
          />

          {/* Tabs - all counts wait for characters to load for synchronized fade-in */}
          <VNTabs
            activeTab={activeTab}
            onTabChange={handleTabChange}
            tagCount={charactersLoaded ? vn.tags?.filter(t => showTagSpoilers || t.spoiler === 0).length : undefined}
            traitCount={charactersLoaded ? traitsReadyCount : undefined}
            characterCount={charactersLoaded ? characters.filter(c => showCharacterSpoilers || (c.spoiler ?? 0) === 0).length : undefined}
          />

          {/* Tab Content - min-height prevents layout shift when switching between tabs with different content sizes */}
          <div className="min-h-[400px]">
          {activeTab === 'summary' && (
            <FadeIn duration={200} slideUp={false}>
            <div className="space-y-6">
              <VNDescription description={vn.description} />
              <VNTags tags={vn.tags} />
              {/* Language filter - applies to relations and similar VNs */}
              {((vn.relations && vn.relations.length > 0) || similarLoading || (similarData?.content_similar?.length || 0) > 0 || (similarData?.users_also_read?.length || 0) > 0) && (
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
              />
              <VNSimilar
                similar={(similarData?.users_also_read || []).filter(
                  vn => !japaneseOnly || vn.olang === 'ja'
                )}
                isLoading={similarLoading}
              />
            </div>
            </FadeIn>
          )}

          {activeTab === 'tags' && (
            <div key="tags" className="animate-fade-in">
            <VNTagsTable
              tags={vn.tags}
              showSpoilers={showTagSpoilers}
              onShowSpoilersChange={setShowTagSpoilers}
            />
            </div>
          )}

          {activeTab === 'traits' && (
            <div key="traits" className="animate-fade-in">
            <VNTraits
              characters={characters}
              isLoading={charactersLoading}
              showSpoilers={showTraitSpoilers}
              onShowSpoilersChange={setShowTraitSpoilers}
              onTraitsReady={handleTraitsReady}
            />
            </div>
          )}

          {activeTab === 'characters' && (
            <div key="characters" className="animate-fade-in">
            <VNCharacters
              characters={characters}
              isLoading={charactersLoading}
              showSpoilers={showCharacterSpoilers}
              onShowSpoilersChange={setShowCharacterSpoilers}
            />
            </div>
          )}
          </div>
        </div>
      </div>

      {/* VNDB Attribution */}
      <VNDBAttribution />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div>
        <div className="flex items-center justify-between mb-6">
          <div className="w-20 h-10 rounded-lg image-placeholder" />
          <div className="w-32 h-10 rounded-lg image-placeholder" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
          <div className="aspect-[3/4] max-w-[280px] mx-auto lg:mx-0 rounded-xl image-placeholder" />
          <div className="space-y-6">
            <div>
              <div className="w-3/4 h-8 rounded mb-2 image-placeholder" />
              <div className="w-1/2 h-6 rounded image-placeholder" />
            </div>
            <div className="h-10 rounded image-placeholder" />
            <div className="h-48 rounded-xl image-placeholder" />
            <div className="h-32 rounded-xl image-placeholder" />
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
