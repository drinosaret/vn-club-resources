import { useState, useCallback, useRef, useEffect } from 'react';
import { DEFAULT_TIER_DEFS, getAutoTierForDefs, generateTierId } from '@/lib/tier-config';
import type { TierDef, TierVN, TierColor, TierPreset, TierListMode } from '@/lib/tier-config';
import type { VNDBListItem } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { getDisplayTitle, type TitlePreference } from '@/lib/title-preference';
import { fetchSharedLayout, fetchBatchVNs, fetchBatchCharacters } from '@/lib/shared-layout-api';
const STORAGE_KEY = 'vn-tierlist-current';
const MAX_TIER_LIST_VNS = 500;
const MAX_TIERS = 15;

// === Persisted state ===

interface PersistedState {
  mode: TierListMode;
  tierDefs: TierDef[];
  tiers: Record<string, string[]>;
  pool: string[];
  vnMap: Record<string, TierVN>;
  importedUser: string | null;
  listTitle: string;
}

type TierListState = PersistedState;

function buildEmptyState(): TierListState {
  const tierDefs = DEFAULT_TIER_DEFS.map(t => ({ ...t }));
  const tiers: Record<string, string[]> = {};
  for (const tier of tierDefs) {
    tiers[tier.id] = [];
  }
  return { mode: 'vns', tierDefs, tiers, pool: [], vnMap: {}, importedUser: null, listTitle: '' };
}

function loadFromStorage(): TierListState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: PersistedState = JSON.parse(raw);
    if (!parsed.tierDefs?.length || !parsed.tiers || !parsed.vnMap) return null;
    return { ...parsed, mode: parsed.mode ?? 'vns', pool: parsed.pool ?? [], importedUser: parsed.importedUser ?? null, listTitle: parsed.listTitle ?? '' };
  } catch {
    return null;
  }
}

/** Returns false if save failed (e.g. quota exceeded). */
function saveToStorage(state: TierListState): boolean {
  try {
    const { mode, tierDefs, tiers, pool, vnMap, importedUser, listTitle } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, tierDefs, tiers, pool, vnMap, importedUser, listTitle }));
    return true;
  } catch {
    return false;
  }
}

// === Helpers ===

function findTierForItem(tiers: Record<string, string[]>, itemId: string): string | null {
  for (const [tierId, items] of Object.entries(tiers)) {
    if (items.includes(itemId)) return tierId;
  }
  return null;
}

/** Find which container an item lives in: a tier ID, 'pool', or null */
function findContainer(state: TierListState, itemId: string): string | null {
  if (state.pool.includes(itemId)) return 'pool';
  return findTierForItem(state.tiers, itemId);
}

/** Get the items array for a container (tier or pool) */
function getContainerItems(state: TierListState, containerId: string): string[] {
  if (containerId === 'pool') return state.pool;
  return state.tiers[containerId] ?? [];
}

/** Convert VNDBListItem to TierVN — stores raw API title for proper language resolution */
function vndbItemToTierVN(item: VNDBListItem): TierVN {
  const imageUrl = item.vn?.image?.url
    ? getProxiedImageUrl(item.vn.image.url, { vnId: item.id })
    : null;
  return {
    id: item.id,
    title: item.vn?.title || item.id,
    titleJp: item.vn?.title_jp ?? undefined,
    titleRomaji: item.vn?.title_romaji ?? undefined,
    imageUrl,
    imageSexual: item.vn?.image?.sexual ?? null,
    defaultImageUrl: imageUrl,
    vote: item.vote ?? undefined,
  };
}

// === Shared settings (returned from loadFromShare) ===

export interface TierListSharedSettings {
  displayMode?: string;
  thumbnailSize?: string;
  showTitles?: boolean;
  showScores?: boolean;
  titleMaxH?: number;
  cropSquare?: boolean;
  titlePreference?: 'romaji' | 'japanese';
}

// === Hook ===

export function useTierListState(shareId?: string) {
  const [state, setState] = useState<TierListState>(buildEmptyState);
  const [hydrated, setHydrated] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const hydratedRef = useRef(false);

  // Hydrate from localStorage after mount to avoid SSR mismatch
  // Skip when loading a shared link to avoid flash of stale state
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (!shareId) {
      const saved = loadFromStorage();
      if (saved) setState(saved);
    }
    setHydrated(true);
  }, [shareId]);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveStatus, setSaveStatus] = useState<{ type: 'saved'; time: number } | { type: 'cleared' } | null>(null);
  const viewingShareRef = useRef(false);

  const debouncedSave = useCallback((newState: TierListState) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (saveToStorage(newState)) setSaveStatus({ type: 'saved', time: Date.now() });
      else setStorageWarning(true);
    }, 300);
  }, []);

  const [needsUrlReset, setNeedsUrlReset] = useState(false);

  useEffect(() => {
    if (!needsUrlReset) return;
    setNeedsUrlReset(false);
    const base = window.location.pathname.replace(/\/s\/[^/]+\/?$/, '/');
    const scrollY = window.scrollY;
    const prev = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    history.replaceState(null, '', base);
    // Restore scroll position after Next.js processes the URL change
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollY);
      history.scrollRestoration = prev;
    });
  }, [needsUrlReset]);

  // Save whenever state changes (except activeId)
  const updateState = useCallback((updater: (prev: TierListState) => TierListState) => {
    setState(prev => {
      const next = updater(prev);
      // On first edit of a shared link, reset URL to base path so autosave kicks in
      if (viewingShareRef.current) {
        viewingShareRef.current = false;
        setNeedsUrlReset(true);
      }
      debouncedSave(next);
      return next;
    });
  }, [debouncedSave]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // === DnD handler ===

  const handleDrop = useCallback((itemId: string, targetContainerId: string, insertIndex: number) => {
    updateState(prev => {
      const sourceContainer = findContainer(prev, itemId);
      if (!sourceContainer) return prev;

      if (sourceContainer === targetContainerId) {
        // Same container: reorder
        const items = [...getContainerItems(prev, sourceContainer)];
        const fromIndex = items.indexOf(itemId);
        if (fromIndex === -1) return prev;
        items.splice(fromIndex, 1);
        const toIndex = Math.min(insertIndex > fromIndex ? insertIndex - 1 : insertIndex, items.length);
        if (fromIndex === toIndex && items.length === getContainerItems(prev, sourceContainer).length) return prev;
        items.splice(toIndex, 0, itemId);
        if (sourceContainer === 'pool') return { ...prev, pool: items };
        return { ...prev, tiers: { ...prev.tiers, [sourceContainer]: items } };
      }

      // Cross-container: move item
      const newTiers = { ...prev.tiers };
      let newPool = [...prev.pool];

      if (sourceContainer === 'pool') {
        newPool = newPool.filter(id => id !== itemId);
      } else {
        newTiers[sourceContainer] = prev.tiers[sourceContainer].filter(id => id !== itemId);
      }

      const destItems = targetContainerId === 'pool' ? newPool : [...(newTiers[targetContainerId] ?? [])];
      destItems.splice(Math.min(insertIndex, destItems.length), 0, itemId);

      if (targetContainerId === 'pool') {
        newPool = destItems;
      } else {
        newTiers[targetContainerId] = destItems;
      }

      return { ...prev, tiers: newTiers, pool: newPool };
    });
  }, [updateState]);

  // === VN management ===

  const addVN = useCallback((vn: TierVN, directToTier = false) => {
    updateState(prev => {
      if (prev.vnMap[vn.id]) return prev; // duplicate
      if (Object.keys(prev.vnMap).length >= MAX_TIER_LIST_VNS) return prev;

      const vnWithDefault = { ...vn, defaultImageUrl: vn.defaultImageUrl ?? vn.imageUrl };
      const newVnMap = { ...prev.vnMap, [vn.id]: vnWithDefault };

      if (directToTier && prev.tierDefs.length > 0) {
        // Add to the last tier
        const lastTierId = prev.tierDefs[prev.tierDefs.length - 1].id;
        return {
          ...prev,
          vnMap: newVnMap,
          tiers: { ...prev.tiers, [lastTierId]: [...(prev.tiers[lastTierId] || []), vn.id] },
        };
      }

      return {
        ...prev,
        vnMap: newVnMap,
        pool: [...prev.pool, vn.id],
      };
    });
  }, [updateState]);

  const addVNToTier = useCallback((vn: TierVN, tierId: string) => {
    updateState(prev => {
      if (prev.vnMap[vn.id]) return prev; // duplicate
      if (Object.keys(prev.vnMap).length >= MAX_TIER_LIST_VNS) return prev;
      if (!prev.tiers[tierId]) return prev; // tier doesn't exist

      const vnWithDefault = { ...vn, defaultImageUrl: vn.defaultImageUrl ?? vn.imageUrl };
      return {
        ...prev,
        vnMap: { ...prev.vnMap, [vn.id]: vnWithDefault },
        tiers: { ...prev.tiers, [tierId]: [...prev.tiers[tierId], vn.id] },
      };
    });
  }, [updateState]);

  const movePoolItemToTier = useCallback((vnId: string, tierId: string) => {
    updateState(prev => {
      if (!prev.pool.includes(vnId)) return prev;
      if (!prev.tiers[tierId]) return prev;

      return {
        ...prev,
        pool: prev.pool.filter(id => id !== vnId),
        tiers: { ...prev.tiers, [tierId]: [...prev.tiers[tierId], vnId] },
      };
    });
  }, [updateState]);

  const updateVN = useCallback((vnId: string, updates: Partial<Pick<TierVN, 'customTitle' | 'vote' | 'imageUrl' | 'imageSexual'>>) => {
    updateState(prev => {
      if (!prev.vnMap[vnId]) return prev;
      return {
        ...prev,
        vnMap: { ...prev.vnMap, [vnId]: { ...prev.vnMap[vnId], ...updates } },
      };
    });
  }, [updateState]);

  const removeVN = useCallback((vnId: string) => {
    updateState(prev => {
      const container = findContainer(prev, vnId);
      if (!container) return prev;

      const newVnMap = { ...prev.vnMap };
      delete newVnMap[vnId];

      if (container === 'pool') {
        return {
          ...prev,
          vnMap: newVnMap,
          pool: prev.pool.filter(id => id !== vnId),
        };
      }

      return {
        ...prev,
        vnMap: newVnMap,
        tiers: { ...prev.tiers, [container]: prev.tiers[container].filter(id => id !== vnId) },
      };
    });
  }, [updateState]);

  const moveToPool = useCallback((vnId: string) => {
    updateState(prev => {
      const tierId = findTierForItem(prev.tiers, vnId);
      if (!tierId) return prev; // already in pool or not found

      return {
        ...prev,
        tiers: { ...prev.tiers, [tierId]: prev.tiers[tierId].filter(id => id !== vnId) },
        pool: [...prev.pool, vnId],
      };
    });
  }, [updateState]);

  const importFromVNDB = useCallback((items: VNDBListItem[], toPool = false) => {
    updateState(prev => {
      const newVnMap = { ...prev.vnMap };
      const newTiers = { ...prev.tiers };
      let newPool = [...prev.pool];

      for (const def of prev.tierDefs) {
        if (!newTiers[def.id]) newTiers[def.id] = [];
      }

      const sortableDefs = prev.tierDefs.filter(t => !t.noAutoSort);
      const sorted = [...items].sort((a, b) => (b.vote ?? 0) - (a.vote ?? 0));
      for (const item of sorted) {
        if (newVnMap[item.id]) continue;
        if (Object.keys(newVnMap).length >= MAX_TIER_LIST_VNS) break;
        newVnMap[item.id] = vndbItemToTierVN(item);

        if (toPool) {
          newPool.push(item.id);
        } else {
          const tierId = getAutoTierForDefs(sortableDefs.length > 0 ? sortableDefs : prev.tierDefs, item.vote);
          if (!newTiers[tierId]) continue;
          newTiers[tierId] = [...(newTiers[tierId] ?? []), item.id];
        }
      }

      return { ...prev, vnMap: newVnMap, tiers: newTiers, pool: newPool };
    });
  }, [updateState]);

  // === Tier management ===

  const addTier = useCallback(() => {
    updateState(prev => {
      if (prev.tierDefs.length >= MAX_TIERS) return prev;
      const id = generateTierId();
      const newDef: TierDef = {
        id,
        label: '?',
        color: 'bg-gray-300 dark:bg-gray-600',
        textColor: 'text-gray-700 dark:text-gray-200',
        noAutoSort: true,
      };
      return {
        ...prev,
        tierDefs: [...prev.tierDefs, newDef],
        tiers: { ...prev.tiers, [id]: [] },
      };
    });
  }, [updateState]);

  const removeTier = useCallback((tierId: string) => {
    updateState(prev => {
      if (prev.tierDefs.length <= 1) return prev;
      const removedVnIds = prev.tiers[tierId] ?? [];
      const newTiers = { ...prev.tiers };
      delete newTiers[tierId];
      // Move displaced VNs to pool instead of deleting them
      const newPool = [...prev.pool, ...removedVnIds];
      return {
        ...prev,
        tierDefs: prev.tierDefs.filter(t => t.id !== tierId),
        tiers: newTiers,
        pool: newPool,
      };
    });
  }, [updateState]);

  const renameTier = useCallback((tierId: string, label: string) => {
    updateState(prev => ({
      ...prev,
      tierDefs: prev.tierDefs.map(t => t.id === tierId ? { ...t, label } : t),
    }));
  }, [updateState]);

  const recolorTier = useCallback((tierId: string, tierColor: TierColor) => {
    updateState(prev => ({
      ...prev,
      tierDefs: prev.tierDefs.map(t =>
        t.id === tierId ? { ...t, color: tierColor.color, textColor: tierColor.textColor } : t
      ),
    }));
  }, [updateState]);

  const clearTier = useCallback((tierId: string) => {
    updateState(prev => {
      const vnIds = prev.tiers[tierId] ?? [];
      if (vnIds.length === 0) return prev;
      const newVnMap = { ...prev.vnMap };
      for (const vnId of vnIds) {
        // Only remove from vnMap if not in other tiers or pool
        const elsewhere = prev.pool.includes(vnId) ||
          Object.entries(prev.tiers).some(([tid, ids]) => tid !== tierId && ids.includes(vnId));
        if (!elsewhere) delete newVnMap[vnId];
      }
      return { ...prev, tiers: { ...prev.tiers, [tierId]: [] }, vnMap: newVnMap };
    });
  }, [updateState]);

  const moveTier = useCallback((tierId: string, direction: 'up' | 'down') => {
    updateState(prev => {
      const index = prev.tierDefs.findIndex(t => t.id === tierId);
      if (index === -1) return prev;
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= prev.tierDefs.length) return prev;
      const newDefs = [...prev.tierDefs];
      [newDefs[index], newDefs[swapIndex]] = [newDefs[swapIndex], newDefs[index]];
      return { ...prev, tierDefs: newDefs };
    });
  }, [updateState]);

  const insertTier = useCallback((relativeTo: string, position: 'above' | 'below') => {
    updateState(prev => {
      if (prev.tierDefs.length >= MAX_TIERS) return prev;
      const index = prev.tierDefs.findIndex(t => t.id === relativeTo);
      if (index === -1) return prev;
      const id = generateTierId();
      const newDef: TierDef = {
        id,
        label: '?',
        color: 'bg-gray-300 dark:bg-gray-600',
        textColor: 'text-gray-700 dark:text-gray-200',
        noAutoSort: true,
      };
      const insertAt = position === 'above' ? index : index + 1;
      const newDefs = [...prev.tierDefs];
      newDefs.splice(insertAt, 0, newDef);
      return { ...prev, tierDefs: newDefs, tiers: { ...prev.tiers, [id]: [] } };
    });
  }, [updateState]);

  const applyPreset = useCallback((preset: TierPreset) => {
    setState(prev => {
      const newTierDefs = preset.tiers.map(t => ({ ...t }));
      const newTiers: Record<string, string[]> = {};
      for (const tier of newTierDefs) {
        newTiers[tier.id] = [];
      }

      // No existing VNs — just reset (preserve pool)
      if (Object.keys(prev.vnMap).length === 0) {
        const next: TierListState = { mode: prev.mode, tierDefs: newTierDefs, tiers: newTiers, pool: prev.pool, vnMap: {}, importedUser: null, listTitle: prev.listTitle };
        saveToStorage(next);
        return next;
      }

      // Redistribute existing VNs into new tiers
      const oldTierDefs = prev.tierDefs;
      for (const [tierId, vnIds] of Object.entries(prev.tiers)) {
        const oldIndex = oldTierDefs.findIndex(t => t.id === tierId);
        for (const vnId of vnIds) {
          const vn = prev.vnMap[vnId];
          if (!vn) continue;
          let destId: string;
          if (vn.vote) {
            destId = getAutoTierForDefs(newTierDefs, vn.vote);
          } else {
            // Proportional mapping for VNs without votes
            const ratio = oldIndex >= 0 ? oldIndex / Math.max(1, oldTierDefs.length) : 0.5;
            const newIndex = Math.min(newTierDefs.length - 1, Math.floor(ratio * newTierDefs.length));
            destId = newTierDefs[newIndex].id;
          }
          if (newTiers[destId]) {
            newTiers[destId].push(vnId);
          }
        }
      }

      const next: TierListState = {
        mode: prev.mode,
        tierDefs: newTierDefs,
        tiers: newTiers,
        pool: prev.pool,
        vnMap: prev.vnMap,
        importedUser: prev.importedUser,
        listTitle: prev.listTitle,
      };
      saveToStorage(next);
      return next;
    });
  }, []);

  const setMode = useCallback((newMode: TierListMode) => {
    updateState(prev => {
      if (prev.mode === newMode) return prev;
      // Keep tier structure, clear items
      const emptyTiers: Record<string, string[]> = {};
      for (const def of prev.tierDefs) emptyTiers[def.id] = [];
      return { ...prev, mode: newMode, tiers: emptyTiers, pool: [], vnMap: {}, importedUser: null };
    });
  }, [updateState]);

  // === Share loading ===

  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const loadFromShare = useCallback(async (shareId: string): Promise<TierListSharedSettings | null> => {
    setShareLoading(true);
    setShareError(null);
    try {
      const layout = await fetchSharedLayout(shareId);
      if (layout.type !== 'tierlist') {
        setShareError('Invalid share type');
        return null;
      }
      const data = layout.data as {
        mode?: string;
        tierDefs?: TierDef[];
        tiers?: Record<string, string[]>;
        pool?: string[];
        listTitle?: string;
        settings?: TierListSharedSettings;
        overrides?: Record<string, Record<string, unknown>>;
      };
      const mode = (data.mode === 'characters' ? 'characters' : 'vns') as TierListMode;
      const tierDefs = data.tierDefs ?? DEFAULT_TIER_DEFS;
      const tiers = data.tiers ?? {};
      const pool = Array.isArray(data.pool) ? data.pool.filter((id): id is string => typeof id === 'string') : [];
      const listTitle = data.listTitle ?? '';
      const settings = data.settings;
      const overrides = data.overrides;

      // Collect all unique item IDs from tiers and pool
      const allIds = new Set<string>();
      for (const items of Object.values(tiers)) {
        if (Array.isArray(items)) {
          for (const id of items) if (typeof id === 'string') allIds.add(id);
        }
      }
      for (const id of pool) allIds.add(id);
      const itemIds = [...allIds];
      const prefix = mode === 'characters' ? 'c' : 'v';
      const validIds = itemIds.filter(id => id.startsWith(prefix));

      // Fetch metadata
      const items = mode === 'characters'
        ? await fetchBatchCharacters(validIds)
        : await fetchBatchVNs(validIds);

      // Use sharer's title preference if available, else fall back to localStorage
      let pref: TitlePreference = 'romaji';
      if (settings?.titlePreference === 'japanese' || settings?.titlePreference === 'romaji') {
        pref = settings.titlePreference;
      } else {
        try {
          const stored = localStorage.getItem('vn-title-preference');
          if (stored === 'japanese' || stored === 'romaji') pref = stored;
        } catch { /* ignore */ }
      }

      const newVnMap: Record<string, TierVN> = {};
      for (const item of items) {
        const imageUrl = item.image_url
          ? getProxiedImageUrl(item.image_url, { vnId: item.id })
          : null;
        const title = mode === 'characters'
          ? (pref === 'japanese' && item.title_jp ? item.title_jp : item.title)
          : getDisplayTitle({ title: item.title, title_jp: item.title_jp ?? undefined, title_romaji: item.title_romaji ?? undefined }, pref);
        newVnMap[item.id] = {
          id: item.id,
          title: title || item.id,
          titleJp: item.title_jp ?? undefined,
          titleRomaji: item.title_romaji ?? undefined,
          imageUrl,
          defaultImageUrl: imageUrl,
          imageSexual: item.image_sexual ?? null,
        };
      }

      // Merge overrides onto fetched items
      if (overrides) {
        for (const [id, o] of Object.entries(overrides)) {
          if (!newVnMap[id]) continue;
          if (typeof o.customTitle === 'string') newVnMap[id].customTitle = o.customTitle;
          if (typeof o.imageUrl === 'string') {
            newVnMap[id].imageUrl = o.imageUrl;
            if (typeof o.imageSexual === 'number') newVnMap[id].imageSexual = o.imageSexual;
          }
          if (typeof o.vote === 'number') newVnMap[id].vote = o.vote;
        }
      }

      // Ensure tiers object has entries for all tierDefs
      const finalTiers: Record<string, string[]> = {};
      for (const def of tierDefs) {
        finalTiers[def.id] = (tiers[def.id] ?? []).filter(id => newVnMap[id]);
      }

      const loadedState: TierListState = {
        mode,
        tierDefs,
        tiers: finalTiers,
        pool: pool.filter(id => newVnMap[id]),
        vnMap: newVnMap,
        importedUser: null,
        listTitle,
      };
      setState(loadedState);
      // Save to localStorage so user edits persist across refresh
      saveToStorage(loadedState);
      viewingShareRef.current = true;
      return settings ?? null;
    } catch (err) {
      const msg = err instanceof Error && err.message === 'not_found'
        ? 'Share link not found'
        : err instanceof TypeError
          ? 'Network error - check your connection'
          : 'Failed to load shared layout';
      setShareError(msg);
      return null;
    } finally {
      setShareLoading(false);
    }
  }, []);

  const clearAll = useCallback(() => {
    const fresh = buildEmptyState();
    fresh.mode = state.mode;
    setState(fresh);
    saveToStorage(fresh);
    setSaveStatus({ type: 'cleared' });
  }, [state.mode]);

  const setImportedUser = useCallback((user: string | null) => {
    updateState(prev => ({ ...prev, importedUser: user }));
  }, [updateState]);

  const setListTitle = useCallback((listTitle: string) => {
    updateState(prev => ({ ...prev, listTitle }));
  }, [updateState]);

  const isVNInList = useCallback((vnId: string) => {
    return !!state.vnMap[vnId];
  }, [state.vnMap]);

  const vnCount = Object.keys(state.vnMap).length;
  const isAtCapacity = vnCount >= MAX_TIER_LIST_VNS;
  const isAtTierLimit = state.tierDefs.length >= MAX_TIERS;

  return {
    mode: state.mode,
    tierDefs: state.tierDefs,
    tiers: state.tiers,
    pool: state.pool,
    vnMap: state.vnMap,
    importedUser: state.importedUser,
    listTitle: state.listTitle,
    hydrated,
    vnCount,
    isAtCapacity,
    isAtTierLimit,

    // Mode
    setMode,

    // DnD
    handleDrop,

    // VN management
    addVN,
    addVNToTier,
    movePoolItemToTier,
    updateVN,
    removeVN,
    moveToPool,
    importFromVNDB,
    setImportedUser,
    setListTitle,
    isVNInList,

    // Tier management
    addTier,
    removeTier,
    renameTier,
    recolorTier,
    clearTier,
    moveTier,
    insertTier,
    applyPreset,
    clearAll,

    // Share
    loadFromShare,
    shareLoading,
    shareError,

    // Storage
    storageWarning,
    dismissStorageWarning: useCallback(() => setStorageWarning(false), []),
    saveStatus,
  };
}
