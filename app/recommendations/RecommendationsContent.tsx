'use client';

import { useState, useEffect, useMemo, useRef, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from '@/components/Link';
import dynamic from 'next/dynamic';
import { Search, ChevronDown, ChevronUp, X } from 'lucide-react';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import { getBackendUrl } from '@/lib/config';
import { getDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import { HowItWorksAccordion } from '@/components/recommendations/HowItWorksAccordion';
import TagTraitAutocomplete, { SelectedItem } from '@/components/recommendations/TagTraitAutocomplete';
import {
  ActiveRecommendationChips,
  CompactRecommendationFilters,
  FilterGroup,
} from '@/components/recommendations/CompactRecommendationFilters';
import { SignalWeightControls } from '@/components/recommendations/SignalWeightControls';
import { DiscoveryControl } from '@/components/recommendations/DiscoveryControl';
import { RankingChips } from '@/components/recommendations/RankingChips';
import {
  DEFAULT_LIST,
  ListName,
  RECOMMENDATION_LISTS,
  SignalWeights,
  formatWeightsParam,
  parsePublishedWeights,
  SIGNAL_WEIGHTS,
  isDefaultWeights,
  listByName,
  parseListParam,
} from '@/lib/recommendation-weights';
import { RecommendationListTabs } from '@/components/recommendations/RecommendationListTabs';
import { RecommendationToolbar } from '@/components/recommendations/RecommendationToolbar';
import { RecommendationFilterPanel } from '@/components/recommendations/RecommendationFilterPanel';
import { ResultLayoutToggle } from '@/components/recommendations/ResultLayoutToggle';
import {
  LAYOUT_CONTAINER_CLASS,
  RecommendationResult,
} from '@/components/recommendations/RecommendationResult';
import { RecommendationsSkeleton } from '@/components/recommendations/RecommendationsSkeleton';
import { StatsCrossLinks } from '@/components/stats/StatsCrossLinks';
import { JitenAttribution } from '@/components/JitenAttribution';
import {
  DEFAULT_LAYOUT,
  LAYOUT_PARAM,
  ResultLayout,
  parseLayoutParam,
  readStoredLayout,
  writeStoredLayout,
} from '@/lib/recommendation-layout';
import { Recommendation, RecommendationDetails, Continuation } from '@/lib/recommendation-types';
import { VNBlurb, fetchRecommendationBlurbs } from '@/lib/recommendation-blurbs';
import { ListBlock, ListIntro } from '@/components/recommendations/RecommendationEvidence';
import { ContinuationsStrip } from '@/components/recommendations/ContinuationsStrip';
import { HiddenTitlesBar } from '@/components/recommendations/HiddenTitlesBar';
import { useHiddenTitles } from '@/hooks/useHiddenTitles';
import {
  DEFAULT_FILTERS,
  EMPTY_FILTER_STATE,
  MAX_TAG_TRAIT_FILTERS,
  RecommendationEntity,
  RecommendationFilterState,
  RecommendationFilters,
  buildRecommendationRequest,
  countActiveFilters,
  normalizeFilters,
  parseRecommendationFilters,
  serializeRecommendationFilters,
} from '@/lib/recommendation-filters';

import { FadeIn } from '@/components/FadeIn';
import { ErrorBoundary } from '@/components/ErrorBoundary';

/** Identity used only to compare two filter states; the value never reaches a URL. */
const PENDING_COMPARE_IDENTITY = { uid: '' };

/** What one filter set is, disregarding who it is for, so two of them can be compared. */
const filterIdentity = (state: RecommendationFilterState): string =>
  serializeRecommendationFilters(state, PENDING_COMPARE_IDENTITY);

// Lazy load the modal component to reduce initial bundle size
const RecommendationDetailModal = dynamic(
  () => import('@/components/recommendations/RecommendationDetailModal').then(mod => ({ default: mod.RecommendationDetailModal })),
  { ssr: false }
);

/**
 * How much the recommender had left to choose from once the filters were applied. A
 * restrictive combination can leave too few candidates to rank, which is a different empty
 * result from a profile with nothing to learn from, and the page says which one it is.
 */
/**
 * Reported by both response paths with the same six keys, so a short list can be
 * explained rather than left bare. `filtered` says whether any filter was in force,
 * not how many titles survived one: the surviving count is `candidates`.
 */
interface RecommendationPool {
  /** Candidates that reached scoring. */
  candidates?: number;
  /** Page size the request asked for. */
  requested?: number;
  /** Whether any filter was in force. */
  filtered?: boolean;
  /** Candidate generation ran more than once to compensate for a restrictive filter. */
  widened?: boolean;
  /** The pool was refilled after filtering cut into it. */
  topped_up?: boolean;
  /** Fewer candidates reached scoring than the page asked for. */
  thin?: boolean;
}

interface RecommendationsResponse {
  recommendations: Recommendation[];
  count: number;
  excluded_count: number;
  elapsed_seconds: number;
  pool?: RecommendationPool;
  /**
   * What each signal was worth to the answer on screen. Absent from a page served out of
   * the cache, whose scores were written under the published balance.
   */
  signal_weights?: Partial<SignalWeights>;
  /** Present only when the request set its own weights, saying what was adjusted. */
  weights?: AppliedWeights;
  /** Which list was served, and how well its own signal separated the page. */
  list?: ListBlock;
  /**
   * Whether this came from the nightly copy. A saved page carries its reasons but not the
   * agreement or the predicted mark, neither of which any column holds.
   */
  from_cache?: boolean;
  /** Unread direct sequels of titles the reader has already read and liked. */
  continuations?: Continuation[];
}

/** The endpoint's account of a tuned request: what was asked for, and what it applied. */
interface AppliedWeights {
  custom: boolean;
  preset: string | null;
  requested: Partial<SignalWeights>;
  effective: SignalWeights;
  total: { before_limits: number; applied: number; scaled: boolean };
  adjustments: Array<{
    signal: string | null;
    requested: number;
    applied: number;
    reason: string;
  }>;
}

function poolSurvivors(pool: RecommendationPool | null): number | undefined {
  const value = pool?.candidates;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** How many recommendations one request asks for. */
const RESULT_LIMIT = 100;

/** A response the server sent on purpose, as opposed to a network failure. */
class RequestFailed extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: number | null,
  ) {
    super(`Request failed with ${status}`);
  }
}

/** Only a server fault or a dropped connection is worth asking again about. */
function isRetryable(err: unknown): boolean {
  if (err instanceof RequestFailed) return err.status >= 500;
  return !(err instanceof Error && err.name === 'AbortError');
}

function messageFor(err: unknown): string {
  if (err instanceof Error && err.name === 'AbortError') {
    return 'Request timed out. The server may be busy - please try again.';
  }
  if (err instanceof RequestFailed) {
    if (err.status === 404) {
      return 'That user was not found on VNDB, or their list may be private.';
    }
    if (err.status === 429) {
      const wait = err.retryAfter ? `about ${err.retryAfter} seconds` : 'a minute';
      return `Too many requests for now. Please wait ${wait} and try again.`;
    }
  }
  return 'Failed to load recommendations. Data may be refreshing, please try again in a few minutes.';
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
  const [continuations, setContinuations] = useState<Continuation[]>([]);
  // Titles the reader has taken off this page. Kept in the browser only, so a signal the
  // reader gives about their own taste never leaves it as a request.
  const { hidden, hide, unhide, clear: clearHidden, lastHidden } = useHiddenTitles(userId);
  const [showHidden, setShowHidden] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number | null>(null);
  const [frontendTime, setFrontendTime] = useState<number | null>(null);
  const [loadingElapsed, setLoadingElapsed] = useState(0);
  const loadingStartRef = useRef<number | null>(null);
  // Keyed by list, so a retry running for a tab left in the background cannot be cleared
  // or counted against the tab now on screen.
  const retriesRef = useRef<Map<ListName, { count: number; timer: ReturnType<typeof setTimeout> | null }>>(new Map());

  // Filter state. One object so the query string, the request, and the controls cannot
  // disagree about what is being asked for.
  const [filterState, setFilterState] = useState<RecommendationFilterState>(EMPTY_FILTER_STATE);
  const [pool, setPool] = useState<RecommendationPool | null>(null);
  // The weights the results on screen were scored under, which is what the breakdown in
  // the popup has to divide by. Null until an answer has been received, and null again
  // for an answer scored under the published balance.
  const [appliedWeights, setAppliedWeights] = useState<SignalWeights | null>(null);
  const [weightNotice, setWeightNotice] = useState<AppliedWeights | null>(null);
  // Whether the endpoint reads a reader-supplied balance at all. Assumed not until it
  // says otherwise, so the controls never appear where they would do nothing.
  const [weightsEnabled, setWeightsEnabled] = useState(false);
  // The filter state the results on screen were fetched with, which is not the same as the one
  // in the controls once someone starts editing them again. Holding the whole state rather than a
  // count is what lets the page say the edits in the controls have not reached the list yet.
  const [appliedState, setAppliedState] = useState<RecommendationFilterState | null>(null);
  // The titles on screen before the current fetch. A reader who changes one control and looks only
  // at the first row cannot tell whether anything happened, because the strongest matches are the
  // least likely to move; counting the arrivals says so directly. Null until a second list exists.
  const previousIdsRef = useRef<Map<ListName, Set<string>>>(new Map());
  const [newSinceLast, setNewSinceLast] = useState<number | null>(null);

  // Which tab is selected, and which list the grid below currently holds. They differ while
  // a newly opened tab is still being fetched, and the cards have to be labelled by the
  // second: a card's number and reason mean different things on different lists, so reading
  // them off the tab would relabel the previous list's titles as this one's.
  const [activeList, setActiveList] = useState<ListName>(DEFAULT_LIST);
  const [shownList, setShownList] = useState<ListName>(DEFAULT_LIST);
  const [listBlock, setListBlock] = useState<ListBlock | null>(null);
  const [fromCache, setFromCache] = useState(false);
  // A list is fetched the first time its tab is opened and held afterwards, so moving back
  // and forth between two tabs costs one request each rather than one per visit. The whole
  // store is dropped whenever the filters change, since every held answer was built under
  // the old ones.
  const heldListsRef = useRef<Map<ListName, RecommendationsResponse>>(new Map());
  // The filters every held answer stands for. A request sent under an earlier set can land
  // after a newer one is in force, and it is read from a request that is already in flight.
  const appliedIdentityRef = useRef<string | null>(null);
  // The same filters as a state, for the paths that compose an address or a request while an
  // apply is still out. `appliedState` describes the results on screen and lags by design;
  // this says what is in force.
  const appliedStateRef = useRef<RecommendationFilterState | null>(null);
  const [heldLists, setHeldLists] = useState<Set<ListName>>(new Set());
  const [pendingList, setPendingList] = useState<ListName | null>(null);
  const pendingListRef = useRef<ListName | null>(null);
  // The list the newest request belongs to. An answer for anything else is stored and not
  // shown, so a slow tab cannot overwrite the one that has since been opened.
  const activeListRef = useRef<ListName>(DEFAULT_LIST);
  // The tokens the endpoint actually serves. The labels are held here because it publishes
  // none, but it stays the authority on which lists exist.
  const [publishedLists, setPublishedLists] = useState<Set<string> | null>(null);
  // The vector an untuned request runs under, as the catalogue publishes it. Every
  // comparison against the default reads this, so the page cannot disagree with the
  // engine about what the default is.
  const [publishedWeights, setPublishedWeights] = useState<SignalWeights | null>(null);
  const baselineWeights = publishedWeights ?? SIGNAL_WEIGHTS;

  // How it works dropdown state
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  // How the results are drawn. Not part of the filter state: it changes nothing about what
  // was asked for, and folding it in would make picking a layout read as an unapplied edit.
  const [layout, setLayoutState] = useState<ResultLayout>(DEFAULT_LAYOUT);
  const layoutRef = useRef<ResultLayout>(DEFAULT_LAYOUT);

  // Descriptions for the layout that shows them, kept across a filter change: prose is a
  // fact about a title rather than about the query that surfaced it.
  const [blurbs, setBlurbs] = useState<Map<string, VNBlurb>>(new Map());
  const [blurbsLoaded, setBlurbsLoaded] = useState(false);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersTriggerRef = useRef<HTMLButtonElement>(null);
  // Applying is not the same as loading. Opening a tab loads too, and a button that spins
  // for a tab switch says the wrong thing about the edits still waiting.
  const [isApplying, setIsApplying] = useState(false);

  // Track last processed search params to avoid duplicate fetches
  const lastProcessedParams = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    fetch(`${getBackendUrl()}/api/v1/recommendations/presets`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        setWeightsEnabled(Boolean(data?.enabled));
        const names = Array.isArray(data?.lists)
          ? data.lists.map((entry: { name?: string }) => entry?.name).filter(Boolean)
          : [];
        if (names.length > 0) setPublishedLists(new Set<string>(names));
        const published = parsePublishedWeights(data);
        if (published) setPublishedWeights(published);
      })
      .catch(() => {
        // An unreachable catalogue leaves the controls hidden, which is the state the
        // page renders correctly in.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Clean up retry timers on unmount
  useEffect(() => {
    const retries = retriesRef.current;
    return () => {
      retries.forEach((entry) => {
        if (entry.timer) clearTimeout(entry.timer);
      });
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
  const [detailsFailed, setDetailsFailed] = useState(false);
  // The card whose breakdown is being waited on. An answer arriving after the popup was
  // dismissed, or after a different card was opened, belongs to neither.
  const openDetailRef = useRef<string | null>(null);

  // Fetch details for a specific recommendation (with timeout)
  const fetchDetailsForVn = async (rec: Recommendation): Promise<RecommendationDetails | null> => {
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), 15000); // 15 second timeout

    try {
      // The breakdown is computed under the same balance as the list, or it adds up to a
      // different percentage than the card it was opened from.
      const tuned = formatWeightsParam(appliedWeights, baselineWeights);
      const query = tuned ? `?weights=${encodeURIComponent(tuned)}` : '';
      const response = await fetch(
        `${getBackendUrl()}/api/v1/recommendations/${userId}/v2/details/${rec.vn_id}${query}`,
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
    // The drawer is drawn over the popup and the popup puts the drawer out of reach, so the
    // two cannot share the screen. Shut without moving focus, which the dialog is about to
    // take for itself.
    setFiltersOpen(false);
    openDetailRef.current = rec.vn_id;

    if (rec.details) {
      // Details already loaded, just show modal. Another card's request may still be out,
      // so its pending state is cleared rather than inherited.
      setIsLoadingDetails(false);
      setDetailsFailed(false);
      setSelectedRec(rec);
      return;
    }

    // Need to fetch details
    setSelectedRec(rec);  // Show modal with loading state
    setIsLoadingDetails(true);
    setDetailsFailed(false);

    const details = await fetchDetailsForVn(rec);
    // The breakdown is a fact about the title and is kept whatever is on screen, but the
    // popup is only written to while it is still the one this card opened.
    const stillOpen = openDetailRef.current === rec.vn_id;
    if (details) {
      // Update the recommendation with fetched details
      const updatedRec = { ...rec, details };
      if (stillOpen) setSelectedRec(updatedRec);
      // Also update in the main list so we don't refetch next time
      setRecommendations(prev =>
        prev.map(r => r.vn_id === rec.vn_id ? updatedRec : r)
      );
      // The held answer for this tab is a separate copy from the live list, so it needs
      // the same update or reopening the tab from cache would fetch the breakdown again.
      const held = heldListsRef.current.get(shownList);
      if (held) {
        heldListsRef.current.set(shownList, {
          ...held,
          recommendations: held.recommendations.map((r) => (r.vn_id === rec.vn_id ? updatedRec : r)),
        });
      }
    } else if (stillOpen) {
      setDetailsFailed(true);
    }
    if (stillOpen) setIsLoadingDetails(false);
  };

  /**
   * Settle the layout before the first list can be painted.
   *
   * Declared above the effect that reads the reader out of the address, and effects run in
   * the order they are declared, so the layout is resolved in the same pass that first has a
   * user to draw results for. The address wins over the stored choice: a link has to
   * reproduce the view it was copied from. Only the control writes the stored choice, so
   * following someone else's link shows their layout without adopting it.
   *
   * Read from the live address rather than the router's copy, which can be served stale from
   * a cached payload on a back navigation, and read after mount rather than during render,
   * since storage does not exist while the page is being rendered on the server.
   */
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get(LAYOUT_PARAM);
    const next = fromUrl ? parseLayoutParam(fromUrl) : readStoredLayout() ?? DEFAULT_LAYOUT;
    layoutRef.current = next;
    setLayoutState(next);
  }, []);

  // Load user and filters from URL params (or reset when params are cleared)
  useEffect(() => {
    // Deduplicate: skip if searchParams string hasn't actually changed
    const paramsString = searchParams.toString();
    if (paramsString === lastProcessedParams.current) return;
    lastProcessedParams.current = paramsString;

    const uid = searchParams.get('uid');
    const uname = searchParams.get('username');
    // The uid arrives from the query string and goes on to build a request path, so it is
    // accepted only in the shape VNDB issues.
    if (uid && /^u?\d+$/.test(uid)) {
      setUserId(uid);
      if (uname) setUsername(uname);

      const urlState = parseRecommendationFilters(searchParams);
      const urlList = parseListParam(searchParams.get('list'));
      setFilterState(urlState);
      setActiveList(urlList);
      activeListRef.current = urlList;
      // A link carries one list, and the filters it carries are new to this page, so
      // nothing held from a previous view applies.
      heldListsRef.current.clear();
      setHeldLists(new Set());
      appliedIdentityRef.current = filterIdentity(urlState);
      appliedStateRef.current = urlState;

      // Pass the parsed filters directly to avoid a race with the state update
      fetchRecommendations(uid, urlState, urlList);
    } else if (uname && uname.trim()) {
      // A link may carry the name rather than the id, which is what someone typing the
      // address themselves or sharing it from another page produces. The name is resolved
      // and the address rewritten to the id, so the loaded view is the one a link
      // reproduces.
      setUsername(uname);
      setIsLoadingUser(true);
      setUserError(null);
      vndbStatsApi
        .lookupUser(uname.trim())
        .then((user) => {
          if (user) {
            router.replace(
              `/recommendations/?uid=${user.uid}&username=${encodeURIComponent(user.username)}`
            );
          } else {
            setUserError(`User "${uname}" not found on VNDB, or their list may be private.`);
          }
        })
        .catch(() => setUserError('Failed to look up user. Please try again.'))
        .finally(() => setIsLoadingUser(false));
    } else {
      // Reset state when navigating back to landing page (no uid in URL)
      setUserId('');
      setUsername('');
      setRecommendations([]);
      previousIdsRef.current.clear();
      heldListsRef.current.clear();
      setHeldLists(new Set());
      setNewSinceLast(null);
      setError(null);
      setPool(null);
      setAppliedWeights(null);
      setWeightNotice(null);
      setListBlock(null);
      setFromCache(false);
      setContinuations([]);
      setActiveList(DEFAULT_LIST);
      setShownList(DEFAULT_LIST);
      activeListRef.current = DEFAULT_LIST;
      setFilterState(EMPTY_FILTER_STATE);
      setAppliedState(null);
      appliedIdentityRef.current = null;
      appliedStateRef.current = null;
      setIsApplying(false);
      // A request still out was issued under the identity cleared here, and an answer to a
      // question already withdrawn does not report the work as finished, so the loading
      // state is stood down with it. Left standing, the elapsed counter never restarts.
      setIsLoading(false);
    }
  }, [searchParams]);

  const updateFilters = (changes: Partial<RecommendationFilters>) => {
    setFilterState((previous) => ({
      ...previous,
      filters: normalizeFilters({ ...previous.filters, ...changes }),
    }));
  };

  const updateTagTraits = (tagTraits: SelectedItem[]) => {
    setFilterState((previous) => ({ ...previous, tagTraits }));
  };

  // Named rather than inline, because the controls and the summary of what is in force are
  // rendered apart from each other and have to change the selection the same way.
  const removeTagTrait = (index: number) => {
    setFilterState((previous) => {
      const tagTraits = [...previous.tagTraits];
      tagTraits.splice(index, 1);
      return { ...previous, tagTraits };
    });
  };

  const toggleTagTraitMode = (index: number) => {
    setFilterState((previous) => {
      const tagTraits = [...previous.tagTraits];
      tagTraits[index] = {
        ...tagTraits[index],
        mode: tagTraits[index].mode === 'include' ? 'exclude' : 'include',
      };
      return { ...previous, tagTraits };
    });
  };

  const updateEntities = (entities: RecommendationEntity[]) => {
    setFilterState((previous) => ({ ...previous, entities }));
  };

  const updateWeights = (weights: SignalWeights | null) => {
    setFilterState((previous) => ({ ...previous, weights }));
  };

  const handleUserSearch = async (e: FormEvent) => {
    e.preventDefault();
    const query = (e.target as HTMLFormElement).username.value.trim();
    if (!query) return;

    setIsLoadingUser(true);
    setUserError(null);

    try {
      const user = await vndbStatsApi.lookupUser(query);
      if (user) {
        // The reader is adopted from the address rather than set here, so the results view
        // is never on screen ahead of the request that fills it: a reader with no list and
        // nothing loading is the state the page describes as an empty result.
        router.push(`/recommendations/?uid=${user.uid}&username=${encodeURIComponent(user.username)}`);
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

  /**
   * Show an answer that is already held. Nothing here requests anything, so switching back
   * to a tab is instant and the endpoint sees one request per list per filter set.
   */
  const showResponse = (data: RecommendationsResponse, list: ListName, isNew: boolean) => {
    const incomingIds = data.recommendations.map((rec) => rec.vn_id);
    // Counted only for an answer that has just been computed, and only against the same
    // list's previous answer. Reopening a held tab has changed nothing, and across two
    // lists the count would be the difference between two different questions.
    const previousIds = previousIdsRef.current.get(list);
    if (isNew) {
      setNewSinceLast(
        previousIds ? incomingIds.filter((id) => !previousIds.has(id)).length : null,
      );
      previousIdsRef.current.set(list, new Set<string>(incomingIds));
    } else {
      setNewSinceLast(null);
      // A held answer took no time to show; reporting the fetch that produced it would
      // report the wrong list's cost.
      setFrontendTime(null);
    }
    setShownList(list);
    setRecommendations(data.recommendations);
    setPool(data.pool ?? null);
    setListBlock(data.list ?? null);
    setFromCache(Boolean(data.from_cache));
    setElapsedTime(data.elapsed_seconds);
    setContinuations(data.continuations ?? []);
  };

  const fetchRecommendations = async (
    uid: string,
    stateOverride?: RecommendationFilterState,
    listOverride?: ListName,
  ) => {
    const list = listOverride ?? activeListRef.current;
    // A fresh request for this list cancels a retry still waiting on its timer. The
    // retry's own continuation arrives with the timer already cleared and keeps its
    // count, which is what bounds the attempts. A retry for a different tab left in
    // the background is untouched.
    const existingRetry = retriesRef.current.get(list);
    if (existingRetry?.timer) {
      clearTimeout(existingRetry.timer);
      retriesRef.current.delete(list);
    }
    setPendingList(list);
    pendingListRef.current = list;
    if (list === activeListRef.current) {
      setIsLoading(true);
      setError(null);
    }
    setFrontendTime(null);

    // The override carries filters that state has not caught up with yet, which is the
    // case on the first load from a URL and on Clear all. Read before the request goes out
    // and compared again when it lands, since another set can be applied in between.
    const requestState = stateOverride ?? filterState;
    const requestIdentity = filterIdentity(requestState);

    const startTime = performance.now();
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), 60000); // 60 second timeout for recommendations

    try {
      const params = buildRecommendationRequest(requestState, RESULT_LIMIT);
      // The combined list is the endpoint's own default, so naming it would only make the
      // request longer. A signal list overrides whatever balance the request also carries,
      // and the answer says so on its `list` block.
      if (list !== DEFAULT_LIST) params.set('list', list);

      const response = await fetch(
        `${getBackendUrl()}/api/v1/recommendations/${uid}/v2?${params}`,
        { signal: abortController.signal }
      );
      clearTimeout(timeoutHandle);

      if (!response.ok) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        throw new RequestFailed(response.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
      }

      const data: RecommendationsResponse = await response.json();
      const endTime = performance.now();

      // An answer stands for the filters it was sent with, whichever tab is on screen when
      // it lands: a list left in the background still says what the results are filtered by.
      // Once a different set has been applied it answers a question nobody is asking, so it
      // is neither held for the next tab switch nor reported as what is in force.
      if (requestIdentity === appliedIdentityRef.current) {
        heldListsRef.current.set(list, data);
        setHeldLists(new Set(heldListsRef.current.keys()));
        setAppliedState(requestState);
      }
      retriesRef.current.delete(list);

      // A slow list that has since been left is kept but not shown, so opening its tab
      // again costs nothing and never overwrites the tab now on screen. An answer built
      // under filters that have since been replaced is out of date the same way: painting
      // it would leave the chips, the badge and the address describing a different list.
      // The weight state is scoped the same way: a background answer for a tab nobody is
      // looking at cannot speak for what the visible tab was scored under.
      if (list === activeListRef.current && requestIdentity === appliedIdentityRef.current) {
        // The endpoint is the authority on what was applied: a value out of range comes
        // back clamped, so the page reads its weights off the answer rather than off the
        // controls that asked for it.
        setAppliedWeights(
          data.weights?.custom ? data.weights.effective : isDefaultWeights(requestState.weights, baselineWeights) ? null : requestState.weights,
        );
        setWeightNotice(data.weights?.adjustments?.length ? data.weights : null);
        showResponse(data, list, true);
        setFrontendTime((endTime - startTime) / 1000);
      }
    } catch (err) {
      clearTimeout(timeoutHandle);

      // A server fault or a dropped connection is retried twice; an answer the server
      // meant, such as a private list or a rate limit, is shown as it is.
      const retryCount = retriesRef.current.get(list)?.count ?? 0;
      if (isRetryable(err) && retryCount < 2) {
        const nextCount = retryCount + 1;
        console.log(`Recommendations fetch failed, retrying (${nextCount}/2) in 10s...`);
        const timer = setTimeout(() => {
          const entry = retriesRef.current.get(list);
          if (entry) entry.timer = null;
          fetchRecommendations(uid, stateOverride, list);
        }, 10000);
        retriesRef.current.set(list, { count: nextCount, timer });
        return; // Keep loading state active
      }

      retriesRef.current.delete(list);
      // Reported on the same terms the answer would have been shown on. A failure under
      // filters that have since been replaced would otherwise put a retry prompt over the
      // request that replaced it, which nothing afterwards clears.
      if (list === activeListRef.current && requestIdentity === appliedIdentityRef.current) {
        console.error('Failed to load recommendations:', err);
        setError(messageFor(err));
      }
    } finally {
      // A list with a retry on its timer is still loading, and so is the request that
      // replaced this one: an answer to a question already withdrawn cannot report the
      // work still out as finished. The apply spinner is not tied to one tab, so it
      // clears whichever list answered; the content spinner belongs to the tab on screen.
      const retrying = retriesRef.current.get(list)?.timer != null;
      if (!retrying && requestIdentity === appliedIdentityRef.current) {
        if (pendingListRef.current === list) {
          setPendingList(null);
          pendingListRef.current = null;
        }
        setIsApplying(false);
        if (list === activeListRef.current) {
          setIsLoading(false);
        }
      }
    }
  };

  /**
   * The page's own address. The list joins the filters in it, so a link reproduces the tab
   * it was copied from as well as the result.
   */
  const pageQuery = (state: RecommendationFilterState, list: ListName): string => {
    const params = serializeRecommendationFilters(state, { uid: userId, username });
    const withList = list === DEFAULT_LIST ? params : `${params}&list=${list}`;
    // The whole query string is rewritten on every apply and every tab, so anything that has
    // to survive one is composed here rather than appended elsewhere.
    const chosen = layoutRef.current;
    return chosen === DEFAULT_LAYOUT ? withList : `${withList}&${LAYOUT_PARAM}=${chosen}`;
  };

  const writeUrl = (state: RecommendationFilterState, list: ListName) => {
    const paramsString = pageQuery(state, list);
    // Update ref so the searchParams effect doesn't trigger a duplicate fetch
    lastProcessedParams.current = paramsString;
    // Update URL without triggering navigation (to avoid resetting state)
    window.history.replaceState(null, '', `?${paramsString}`);
  };

  // Every filter is written to the query string, so a shared link reproduces the exact
  // result and a reload keeps it.
  const applyFilterState = (state: RecommendationFilterState) => {
    if (!userId) return;

    setIsApplying(true);

    writeUrl(state, activeList);
    // Every held list was built under the filters being replaced, so none of them answers
    // the question now being asked. The same settings applied again change nothing, so the
    // held lists stay.
    const nextIdentity = filterIdentity(state);
    const unchanged = appliedState !== null && nextIdentity === filterIdentity(appliedState);
    if (!unchanged) {
      heldListsRef.current.clear();
      setHeldLists(new Set());
    }
    appliedIdentityRef.current = nextIdentity;
    appliedStateRef.current = state;
    fetchRecommendations(userId, state, activeList);
  };

  /**
   * Return focus to the control that is present in every state. The button that was pressed
   * unmounts once its edits are applied, and focus left on a removed element falls to the
   * document.
   */
  const closeFilters = () => {
    setFiltersOpen(false);
    filtersTriggerRef.current?.focus();
  };

  /**
   * Bring the results back under the reader when they are about to be replaced.
   *
   * From the top of the page nothing needs to move. From halfway down one list, landing at
   * the same offset into a different one shows a position rather than an answer.
   */
  const revealResults = () => {
    const panel = document.getElementById('rec-list-panel');
    if (!panel || panel.getBoundingClientRect().top >= 0) return;
    panel.scrollIntoView({ behavior: 'instant', block: 'start' });
  };

  const applyFilters = () => {
    applyFilterState(filterState);
    closeFilters();
    revealResults();
  };

  /**
   * Change how the results are drawn.
   *
   * Written to the address so a link carries it, and to storage so the next visit keeps it.
   * Nothing is refetched: the address is rewritten in place, which does not re-enter the
   * effect that reads it.
   */
  const setLayout = (next: ResultLayout) => {
    if (next === layoutRef.current) return;
    layoutRef.current = next;
    setLayoutState(next);
    writeStoredLayout(next);
    if (userId) writeUrl(appliedStateRef.current ?? filterState, activeListRef.current);
  };

  /** Every narrowing filter off; the ranking settings are not filters and are kept. */
  const clearFilters = () => {
    const next: RecommendationFilterState = {
      ...EMPTY_FILTER_STATE,
      filters: { ...DEFAULT_FILTERS, discovery: filterState.filters.discovery },
      weights: filterState.weights,
    };
    setFilterState(next);
    applyFilterState(next);
  };

  /** The published balance and the default discovery, filters untouched. */
  const resetRanking = () => {
    const next: RecommendationFilterState = {
      ...filterState,
      filters: { ...filterState.filters, discovery: undefined },
      weights: null,
    };
    setFilterState(next);
    applyFilterState(next);
  };

  /**
   * Open a tab. A list is fetched the first time it is opened, as the reference page did:
   * only the combined list is served from the nightly copy, so fetching all nine up front
   * would cost eight computed pages to show one.
   */
  const openList = (list: ListName) => {
    if (list === activeList) return;
    setActiveList(list);
    activeListRef.current = list;
    setNewSinceLast(null);
    if (userId) writeUrl(appliedStateRef.current ?? filterState, list);
    revealResults();

    const held = heldListsRef.current.get(list);
    if (held) {
      setError(null);
      setIsLoading(false);
      showResponse(held, list, false);
      return;
    }
    if (userId) fetchRecommendations(userId, appliedStateRef.current ?? filterState, list);
  };

  /**
   * Descriptions for the layout that shows them.
   *
   * Asked for only while that layout is in force, and only for titles not already held, so
   * moving between layouts and tabs costs nothing after the first page. The whole page is
   * requested at once because it arrives as one reflow at a known moment rather than a
   * hundred of them.
   */
  useEffect(() => {
    if (layout !== 'detail' || recommendations.length === 0) return;

    const missing = recommendations.map((rec) => rec.vn_id).filter((id) => !blurbs.has(id));
    if (missing.length === 0) {
      setBlurbsLoaded(true);
      return;
    }

    let cancelled = false;
    setBlurbsLoaded(false);
    fetchRecommendationBlurbs(missing).then((rows) => {
      if (cancelled) return;
      setBlurbs((prev) => {
        const next = new Map(prev);
        rows.forEach((row) => next.set(row.vn_id, row));
        return next;
      });
      setBlurbsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // `blurbs` is deliberately not a dependency: it is written by this effect, and reading it
    // here as one would re-enter on its own result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, recommendations]);

  // The one figure on this page produced elsewhere, credited where it narrows the results:
  // waiting on a chip, or already applied to the list on screen. The panel carries its own
  // credit beside the scale it names. The applied state is read as well as the draft, so
  // clearing a chip without applying does not drop the credit off results still filtered by it.
  const usesDifficulty =
    filterState.filters.min_difficulty !== undefined ||
    filterState.filters.max_difficulty !== undefined ||
    appliedState?.filters.min_difficulty !== undefined ||
    appliedState?.filters.max_difficulty !== undefined;

  const appliedFilterCount = appliedState ? countActiveFilters(appliedState) : 0;
  // Serialised against a fixed identity on both sides, so a username resolving after the fetch
  // cannot register as an edit the reader never made.
  const hasPendingChanges =
    appliedState !== null && filterIdentity(appliedState) !== filterIdentity(filterState);

  // A pool smaller than the number of recommendations asked for is one the filters cut into,
  // so the page can say the list is short because of them rather than leaving it unexplained.
  const survivingCandidates = poolSurvivors(pool);
  // The page size the answer was actually built against, which a cached answer can report
  // differently from the constant this request asked for.
  const poolRequested = pool?.requested ?? RESULT_LIMIT;
  const poolIsThin =
    appliedFilterCount > 0 &&
    (pool?.thin === true ||
      (survivingCandidates !== undefined && survivingCandidates < poolRequested));

  // Only lists the endpoint says it serves are offered, so a token it drops stops being a
  // tab rather than becoming a tab that answers 400.
  const visibleLists = publishedLists
    ? RECOMMENDATION_LISTS.filter((list) => publishedLists.has(list.name))
    : RECOMMENDATION_LISTS;
  // The list the grid holds, which is what its cards are labelled by.
  const shownListMeta = listByName(shownList) ?? RECOMMENDATION_LISTS[0];
  // How many lists an agreement figure is out of, which is every list except the combined
  // one that reports the figure. Read off the endpoint's own count rather than the local
  // fallback array, so the denominator cannot disagree with the numerator it reports.
  const totalLists = Math.max(1, (publishedLists?.size ?? RECOMMENDATION_LISTS.length) - 1);
  // Whether this list's own signal separated the page. One distinct score means it did not,
  // and the percentage on a card would then be the same number on every card.
  const signalRanks = (listBlock?.distinct_scores ?? 2) > 1;
  // A saved page carries its reasons but nothing that was computed per request. Saying so
  // is better than leaving two lines silently missing from every card.
  // A saved page carries the match number but not where each list placed a title, so
  // the notice keys on the placements rather than on the number.
  const savedPageIsThin = fromCache && recommendations.some((rec) => rec.signals_ranked === undefined);

  // What the reader has hidden, read against this page's own results rather than stored
  // as a count: a title hidden on a previous list may not even be on this one.
  const hiddenIds = useMemo(() => new Set(Object.keys(hidden)), [hidden]);
  const visibleRecommendations = showHidden
    ? recommendations
    : recommendations.filter((rec) => !hiddenIds.has(rec.vn_id));
  const hiddenOnPage = recommendations.filter((rec) => hiddenIds.has(rec.vn_id)).length;
  const lastHiddenRec = lastHidden ? recommendations.find((rec) => rec.vn_id === lastHidden) : undefined;
  const lastHiddenTitle = lastHiddenRec
    ? getDisplayTitle(
        { title: lastHiddenRec.title, title_jp: lastHiddenRec.title_jp ?? undefined, title_romaji: lastHiddenRec.title_romaji ?? undefined },
        titlePreference,
      )
    : null;

  // Built once and placed by the wrapper the layout calls for, so the four layouts differ in
  // how a result is drawn rather than in which results are drawn. The rank shown is the
  // position in the full list, not the filtered one, so hiding a title never renumbers
  // the ones still on screen.
  const resultElements = visibleRecommendations.map((rec) => (
    <RecommendationResult
      key={rec.vn_id}
      rec={rec}
      index={recommendations.indexOf(rec)}
      titlePreference={titlePreference}
      onInfoClick={handleInfoClick}
      list={shownListMeta}
      signalRanks={signalRanks}
      totalLists={totalLists}
      layout={layout}
      blurb={blurbs.get(rec.vn_id)}
      blurbsLoaded={blurbsLoaded}
      onHide={(target, reason) => hide(target.vn_id, reason)}
      isHidden={hiddenIds.has(rec.vn_id)}
    />
  ));

  return (
    <ErrorBoundary>
    <div className={`min-h-[80vh] flex flex-col items-center px-4 ${userId ? 'pt-6 pb-12' : 'py-12'}`}>
      <div className="max-w-5xl w-full">
        {/* Two headers for two jobs. Without a name typed, the page has to say what it is and
            is the face a search engine sees. With results to read, the same heading, the
            reader it is for, and the explanation take one row between them, because every row
            above the list is a row of the list nobody can see. The heading text does not vary
            with the state. */}
        {!userId ? (
          <>
            <div className="text-center mb-8">
              <h1 className="sec-title">VN Recommendations</h1>
              <p className="sec-sub">Personalized recommendations based on your VNDB ratings</p>
            </div>

            <div className="mb-8 max-w-2xl mx-auto">
              <button
                type="button"
                onClick={() => setShowHowItWorks(!showHowItWorks)}
                className="rc-btn rc-btn--wide"
                aria-expanded={showHowItWorks}
              >
                How recommendations work
                {showHowItWorks ? <ChevronUp aria-hidden className="w-4 h-4" /> : <ChevronDown aria-hidden className="w-4 h-4" />}
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <h1 className="font-display text-lg sm:text-xl font-bold text-[color:var(--ink)]">
              VN Recommendations
            </h1>
            <span className="rc-label">for</span>
            <Link href={`/stats/${userId}`} className="sec-more">
              {username || userId}
            </Link>
            <button
              type="button"
              onClick={() => {
                setUserId('');
                setUsername('');
                setRecommendations([]);
                setContinuations([]);
                previousIdsRef.current.clear();
                heldListsRef.current.clear();
                setHeldLists(new Set());
                setNewSinceLast(null);
                setAppliedState(null);
                appliedIdentityRef.current = null;
                appliedStateRef.current = null;
                setIsApplying(false);
                // A request still out was issued under the identity cleared here, and an
                // answer to a question already withdrawn does not report the work as
                // finished, so the loading state is stood down with it.
                setIsLoading(false);
                router.push('/recommendations/');
              }}
              className="rc-btn rc-btn--icon"
              title="Change user"
              aria-label="Change user"
            >
              <X aria-hidden className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowHowItWorks(!showHowItWorks)}
              className="rc-btn ml-auto"
              aria-expanded={showHowItWorks}
            >
              How it works
            </button>
          </div>
        )}

        {showHowItWorks && (
          <div className="rc-panel mb-4 p-5">
            <HowItWorksAccordion list={shownListMeta} totalLists={totalLists} />
          </div>
        )}

        {/* User Search - show when no user selected */}
        {!userId && (
          <>
            <form onSubmit={handleUserSearch} className="mb-8">
              {/* The field and the control that submits it stand side by side rather than one
                  inside the other: a target laid over the end of an input has to be small
                  enough not to cover what is being typed. */}
              <div className="flex flex-wrap justify-center max-w-lg mx-auto gap-2">
                <input
                  type="text"
                  name="username"
                  placeholder="Enter your VNDB username"
                  className="rc-field flex-1 min-w-0 basis-56 px-4 py-3 text-base"
                  disabled={isLoadingUser}
                />
                <button type="submit" disabled={isLoadingUser} className="rc-btn rc-btn--go">
                  {isLoadingUser ? (
                    <span aria-hidden className="rc-spin w-4 h-4" />
                  ) : (
                    <Search aria-hidden className="w-4 h-4" />
                  )}
                  Get recommendations
                </button>
              </div>
              {userError && <p className="rc-caution mt-3 text-center text-sm">{userError}</p>}
            </form>

            {/* Features */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left max-w-2xl mx-auto">
              <FeatureCard
                title="Tag Analysis"
                description="Matches based on your preferred themes and content tags"
              />
              <FeatureCard
                title="Similar Tastes"
                description="VNs loved by users with similar reading history"
              />
              <FeatureCard
                title="Staff Matching"
                description="Works by your favorite writers and developers"
              />
            </div>

            {/* Note */}
            <div className="mt-10 text-center">
              <p className="rc-why">Your VNDB list must be public for recommendations to be generated.</p>
            </div>
          </>
        )}

        {/* One row over the results, holding the two controls that decide what is under it:
            which list, and how narrow. It sticks because the notice that edits have not been
            applied is only useful where the reading happens, which is somewhere down the list. */}
        {userId && (
          <>
            <RecommendationToolbar
              filtersPanelId="rec-filter-panel"
              filtersOpen={filtersOpen}
              onToggleFilters={() => setFiltersOpen((open) => !open)}
              triggerRef={filtersTriggerRef}
              activeFilterCount={appliedFilterCount}
              hasPendingChanges={hasPendingChanges}
              isApplying={isApplying}
              onApply={applyFilters}
            >
              <RecommendationListTabs
                lists={visibleLists}
                active={activeList}
                onChange={openList}
                loaded={heldLists}
                pending={pendingList}
                layout="scroll"
              />
            </RecommendationToolbar>

            <RecommendationFilterPanel
              id="rec-filter-panel"
              open={filtersOpen}
              onClose={closeFilters}
              onApply={applyFilters}
              hasPendingChanges={hasPendingChanges}
              activeCount={countActiveFilters(filterState)}
              onClear={clearFilters}
            >
              {/* The controls are two groups because they do two different things: one decides
                  which titles qualify at all, the other decides how the qualifying ones get
                  ranked. Presented as one flat stack they read as twenty equal knobs, and the
                  two that most change a list are not the twenty. */}
              <div className="space-y-4">
                <TagTraitAutocomplete
                  selectedItems={filterState.tagTraits}
                  onSelectionChange={updateTagTraits}
                  placeholder="Filter by tags or traits..."
                  maxItems={MAX_TAG_TRAIT_FILTERS}
                />

                {/* The summary of what is in force is drawn outside the panel, where it stays
                    visible once the panel is shut. */}
                <CompactRecommendationFilters
                  state={filterState}
                  onFilterChange={updateFilters}
                  onEntitiesChange={updateEntities}
                  onRemoveTagTrait={removeTagTrait}
                  onToggleTagTraitMode={toggleTagTraitMode}
                  onClearAll={clearFilters}
                  showChips={false}
                />
              </div>

              <FilterGroup
                title="Ranking"
                count={(isDefaultWeights(filterState.weights, baselineWeights) ? 0 : 1) + (filterState.filters.discovery ? 1 : 0)}
              >
                <div className="space-y-4">
                {/* Independent of whether signal tuning is on: the two are separate features, and
                    hiding this behind the other's switch makes it invisible whenever tuning is off. */}
                <DiscoveryControl
                  value={filterState.filters.discovery}
                  onChange={(discovery) => updateFilters({ discovery })}
                />

                {(!isDefaultWeights(filterState.weights, baselineWeights) || filterState.filters.discovery) && (
                  <button type="button" onClick={resetRanking} className="rc-btn">
                    Reset ranking
                  </button>
                )}

                {/* A list sets the balance itself, and the endpoint reports the request's own
                    weights as ignored when one does. Offering the sliders there would be a
                    control that provably cannot move anything, which is the fault the tabs
                    exist to fix. */}
                {weightsEnabled && activeList === DEFAULT_LIST && (
                  <SignalWeightControls weights={filterState.weights} onChange={updateWeights} defaults={baselineWeights} />
                )}
                {weightsEnabled && activeList !== DEFAULT_LIST && (
                  <p className="rc-why">
                    The {listByName(activeList)?.label ?? activeList} list is ranked by one signal, so the balance between
                    them decides nothing here. Tuning is on the Combined tab, and a balance already
                    in your link is kept.
                  </p>
                )}
                </div>
              </FilterGroup>
            </RecommendationFilterPanel>

            {/* What is in force, and how the results are drawn. Both describe the page rather
                than compose a request, so they sit outside the panel and stay readable with it
                shut. */}
            <div className="flex items-start gap-3 mb-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <RankingChips
                    defaults={baselineWeights}
                    weights={filterState.weights}
                    discovery={filterState.filters.discovery}
                    onClearWeights={() => {
                      const next = { ...filterState, weights: null };
                      setFilterState(next);
                      applyFilterState(next);
                    }}
                    onClearDiscovery={() => {
                      const next = { ...filterState, filters: { ...filterState.filters, discovery: undefined } };
                      setFilterState(next);
                      applyFilterState(next);
                    }}
                  />
                  <ActiveRecommendationChips
                    state={filterState}
                    onFilterChange={updateFilters}
                    onEntitiesChange={updateEntities}
                    onRemoveTagTrait={removeTagTrait}
                    onToggleTagTraitMode={toggleTagTraitMode}
                    onClearAll={clearFilters}
                  />
                </div>
              </div>
              <ResultLayoutToggle layout={layout} onChange={setLayout} className="shrink-0" />
            </div>

            {usesDifficulty && <JitenAttribution className="mb-3" />}
          </>
        )}

        {/* Crossfade Container - Skeleton and Content */}
        {userId && (
          <FadeIn duration={200}>
            <div
              className="relative min-h-[200px] scroll-mt-28 md:scroll-mt-32"
              id="rec-list-panel"
              role="tabpanel"
              aria-labelledby={`rec-list-tab-${activeList}`}
            >
            {/* The panel exists in every state so the tab that owns it always controls
                something; the visible heading is the tab strip, and this one is for
                readers moving by headings. */}
            <h2 className="sr-only">Results</h2>
            {/* Below the strip, so a failure on one list does not push the control that opens
                another one down the page. */}
            {error && (
              <div className="text-center py-12">
                <p className="rc-caution mb-4 text-sm">{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    const entry = retriesRef.current.get(activeList);
                    if (entry?.timer) clearTimeout(entry.timer);
                    retriesRef.current.delete(activeList);
                    if (userId) fetchRecommendations(userId, appliedStateRef.current ?? filterState, activeList);
                  }}
                  className="rc-btn rc-btn--go"
                >
                  Try Again
                </button>
              </div>
            )}
            {!error && (
            <>
            {/* Skeleton Grid - fades OUT when not loading. A faded pane is still read out
                and still takes focus, so whichever of the two is not the answer is taken
                out of the tree and out of the tab order as well as out of flow. */}
            <div
              className={`transition-opacity duration-300 ${
                isLoading ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0'
              }`}
              aria-hidden={!isLoading}
              inert={!isLoading}
            >
              <div className="flex flex-col items-center justify-center mb-4 gap-1">
                <p className="rc-why flex items-center gap-2">
                  <span aria-hidden className="rc-spin w-3.5 h-3.5" />
                  {loadingElapsed < 5 ? 'Analyzing your ratings...' :
                   loadingElapsed < 15 ? 'Generating recommendations...' :
                   'Processing large collection...'}
                </p>
                {/* The quieter colour goes on a span inside: the class that makes this a
                    footnote sets a colour of its own, which a utility beside it loses to. */}
                <p className="rc-why">
                  <span className="text-[color:var(--text-faint)]">
                    <span className="rc-num">{loadingElapsed}s</span> elapsed
                    {loadingElapsed >= 15 && '. Almost there!'}
                    {loadingElapsed >= 30 && ' (Very large collections may take up to 60s)'}
                  </span>
                </p>
              </div>
              <RecommendationsSkeleton layout={layout} />
            </div>

            {/* Content Grid - fades IN when loaded. The previous list is held while the next
                one is fetched, so it leaves the flow the way the skeleton does when idle, or
                the panel stands as tall as both. Its overflow is clipped too: content spilling
                out of a positioned box still lengthens the page. */}
            {recommendations.length > 0 && (
              <div
                className={`transition-opacity duration-300 ${
                  !isLoading ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0 overflow-hidden'
                }`}
                aria-hidden={isLoading}
                inert={isLoading}
              >
                <div className="flex flex-col items-center justify-center mb-4 gap-1">
                  <p className="rc-why">
                    Found <span className="rc-num">{visibleRecommendations.length}</span> recommendations
                    {frontendTime && ` in ${frontendTime.toFixed(1)}s`}
                    {newSinceLast !== null && (
                      <span className="ml-1">
                        {newSinceLast === 0
                          ? '. Same titles as your last list'
                          : `. ${newSinceLast} not in your last list`}
                      </span>
                    )}
                    {elapsedTime && frontendTime && frontendTime > elapsedTime + 2 && (
                      <span className="ml-1 text-[color:var(--text-faint)]">
                        (backend: {elapsedTime.toFixed(1)}s)
                      </span>
                    )}
                  </p>
                  {weightNotice && (
                    <p className="rc-why rc-caution text-center">
                      {weightNotice.adjustments.map((entry) => entry.reason).join('. ')}.
                    </p>
                  )}
                  {poolIsThin && (
                    <p className="rc-why rc-caution text-center">
                      {survivingCandidates !== undefined
                        ? `Your filters left ${survivingCandidates.toLocaleString()} titles to choose from, so this list is shorter than usual.`
                        : 'Your filters left few titles to choose from, so this list is shorter than usual.'}{' '}
                      Loosen a filter for more.
                    </p>
                  )}
                  <ListIntro
                    list={shownListMeta}
                    block={listBlock}
                    pageSize={recommendations.length}
                  />
                  {/* The predicted mark and the agreement figure are computed per request and
                      no column holds them, so the nightly copy cannot carry either. Naming
                      what is missing beats leaving two lines absent without explanation. */}
                  {savedPageIsThin && (
                    <p className="rc-why text-center max-w-2xl mx-auto">
                      {/* Colour on the span, since the footnote class sets one itself. */}
                      <span className="text-[color:var(--text-faint)]">
                        This is your saved list, rebuilt nightly. How many lists each title
                        placed in is worked out per request: open any other tab, or change a
                        filter, to see it.
                      </span>
                    </p>
                  )}
                </div>

                {shownList === 'combined' && (
                  <ContinuationsStrip items={continuations} titlePreference={titlePreference} hidden={hiddenIds} />
                )}

                <HiddenTitlesBar
                  count={hiddenOnPage}
                  showing={showHidden}
                  onToggleShow={() => setShowHidden((value) => !value)}
                  lastHiddenTitle={lastHiddenTitle}
                  onUndo={() => {
                    if (lastHidden) unhide(lastHidden);
                  }}
                  onClear={clearHidden}
                />

                {/* The wrapper comes from the same table the placeholder above takes it from,
                    so the answer cannot land on a different grid than the one it replaced. */}
                {layout === 'list' ? (
                  <ol className={LAYOUT_CONTAINER_CLASS.list}>{resultElements}</ol>
                ) : (
                  <div className={LAYOUT_CONTAINER_CLASS[layout]}>{resultElements}</div>
                )}
              </div>
            )}
            </>
            )}
            </div>
          </FadeIn>
        )}

        {/* Empty State */}
        {!isLoading && !error && userId && recommendations.length === 0 && (
          <div className="text-center py-12">
            {appliedFilterCount > 0 ? (
              <>
                <p className="mb-2 text-[color:var(--ink)]">Nothing matched these filters.</p>
                <p className="rc-why max-w-md mx-auto">
                  {survivingCandidates !== undefined
                    ? `Of the titles the recommender considered, ${survivingCandidates.toLocaleString()} passed your ${appliedFilterCount} ${appliedFilterCount === 1 ? 'filter' : 'filters'}. `
                    : ''}
                  Try removing the narrowest one, or widening the rating and length ranges.
                </p>
                <button type="button" onClick={clearFilters} className="rc-btn rc-btn--go mt-4">
                  Clear all filters
                </button>
              </>
            ) : (
              <>
                <p className="mb-2 text-[color:var(--ink)]">No recommendations found.</p>
                <p className="rc-why">
                  Make sure your VNDB list is set to public and that you have rated some VNs.
                </p>
              </>
            )}
          </div>
        )}

        <StatsCrossLinks current="recommendations" />
      </div>

      {/* Recommendation Detail Modal */}
      {selectedRec && (
        <RecommendationDetailModal
          recommendation={selectedRec}
          onClose={() => {
            openDetailRef.current = null;
            setSelectedRec(null);
          }}
          isLoading={isLoadingDetails}
          failed={detailsFailed}
          list={shownListMeta}
          totalLists={totalLists}
          signalRanks={signalRanks}
        />
      )}
    </div>
    </ErrorBoundary>
  );
}

/* The heading is the label, so nothing decorative stands beside it. */
function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rc-panel p-5">
      <h2 className="rc-feature-title mb-1.5">{title}</h2>
      <p className="rc-why">{description}</p>
    </div>
  );
}

