import { useState, useCallback, useRef, useEffect } from 'react';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { VNDBListItem } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { getDisplayTitle, type TitlePreference } from '@/lib/title-preference';
import { fetchSharedLayout, fetchBatchVNs, fetchBatchCharacters } from '@/lib/shared-layout-api';

const STORAGE_KEY = 'vn-grid-maker-current';
const SHARE_ID_KEY = 'vn-grid-maker-share-id';

// === Types ===

export type GridMode = 'vns' | 'characters';

export interface CropData {
  crop: { x: number; y: number };
  zoom: number;
  croppedArea: { x: number; y: number; width: number; height: number };
}

export interface GridItem {
  id: string;
  title: string;
  titleJp?: string;
  titleRomaji?: string;
  customTitle?: string;
  imageUrl: string | null;
  imageSexual: number | null;
  defaultImageUrl?: string | null;
  vote?: number;
  released?: string | null;
  rating?: number | null;
  cropData?: CropData;
  /** Blob URL of the cropped preview — generated at crop time, not persisted */
  cropPreview?: string;
  /** Tiny blob URL for NSFW overlay of cropped preview */
  cropPreviewTiny?: string;
}

interface PersistedState {
  mode: GridMode;
  gridSize: 3 | 4 | 5;
  cropSquare: boolean;
  cells: (string | null)[];
  pool: string[];
  itemMap: Record<string, GridItem>;
  importedUser: string | null;
  gridTitle: string;
}

type GridMakerState = PersistedState;

// === Storage ===

function buildEmptyState(size: 3 | 4 | 5 = 3): GridMakerState {
  return {
    mode: 'vns',
    gridSize: size,
    cropSquare: true,
    cells: Array(size * size).fill(null),
    pool: [],
    itemMap: {},
    importedUser: null,
    gridTitle: '',
  };
}

function loadFromStorage(): GridMakerState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: PersistedState = JSON.parse(raw);
    if (!parsed.cells || !parsed.itemMap) return null;
    // Ensure cells length matches gridSize
    const expected = (parsed.gridSize || 3) * (parsed.gridSize || 3);
    if (parsed.cells.length !== expected) {
      parsed.cells = parsed.cells.slice(0, expected);
      while (parsed.cells.length < expected) parsed.cells.push(null);
    }
    return { ...parsed, mode: parsed.mode ?? 'vns', pool: parsed.pool ?? [], cropSquare: parsed.cropSquare ?? true, importedUser: parsed.importedUser ?? null, gridTitle: parsed.gridTitle ?? '' };
  } catch {
    return null;
  }
}

/** Returns false if save failed (e.g. quota exceeded). */
function saveToStorage(state: GridMakerState): boolean {
  try {
    const { mode, gridSize, cropSquare, cells, pool, itemMap, importedUser, gridTitle } = state;
    // Strip blob URLs (cropPreview/cropPreviewTiny) — they're session-specific and can't be restored
    const cleanMap: Record<string, GridItem> = {};
    for (const [k, v] of Object.entries(itemMap)) {
      const { cropPreview, cropPreviewTiny, ...rest } = v;
      cleanMap[k] = rest;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, gridSize, cropSquare, cells, pool, itemMap: cleanMap, importedUser, gridTitle }));
    return true;
  } catch {
    return false;
  }
}

// === Helpers ===

function readTitlePreference(): TitlePreference {
  try {
    const stored = localStorage.getItem('vn-title-preference');
    if (stored === 'japanese' || stored === 'romaji') return stored;
  } catch { /* ignore */ }
  return 'romaji';
}

function vndbItemToGridItem(item: VNDBListItem, preference: TitlePreference): GridItem {
  const imageUrl = item.vn?.image?.url
    ? getProxiedImageUrl(item.vn.image.url, { width: 256, vnId: item.id })
    : null;
  const title = item.vn
    ? getDisplayTitle(item.vn, preference)
    : item.id;
  return {
    id: item.id,
    title: title || item.id,
    titleJp: item.vn?.title_jp ?? undefined,
    titleRomaji: item.vn?.title_romaji ?? undefined,
    imageUrl,
    imageSexual: item.vn?.image?.sexual ?? null,
    defaultImageUrl: imageUrl,
    vote: item.vote ?? undefined,
    released: item.vn?.released ?? null,
    rating: item.vn?.rating ?? null,
  };
}

// === Shared settings (returned from loadFromShare) ===

export interface GridSharedSettings {
  cropSquare?: boolean;
  showFrame?: boolean;
  showTitles?: boolean;
  showScores?: boolean;
  titleMaxH?: number;
  titlePreference?: 'romaji' | 'japanese';
}

// === Hook ===

export function useGridMakerState(shareId?: string) {
  const [state, setState] = useState<GridMakerState>(buildEmptyState);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    // Skip localStorage hydration when loading a shared link to avoid flash
    if (!shareId) {
      const saved = loadFromStorage();
      if (saved) setState(saved);
    }
    setHydrated(true);
  }, [shareId]);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSave = useCallback((newState: GridMakerState) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (!saveToStorage(newState)) setStorageWarning(true);
    }, 300);
  }, []);

  const updateState = useCallback((updater: (prev: GridMakerState) => GridMakerState) => {
    setState(prev => {
      const next = updater(prev);
      debouncedSave(next);
      return next;
    });
  }, [debouncedSave]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // === Mode ===

  const setMode = useCallback((mode: GridMode) => {
    updateState(prev => {
      if (prev.mode === mode) return prev;
      // Clear grid when switching modes
      const fresh = buildEmptyState(prev.gridSize);
      return { ...fresh, mode, gridTitle: prev.gridTitle };
    });
  }, [updateState]);

  // === Crop mode ===

  const setCropSquare = useCallback((cropSquare: boolean) => {
    updateState(prev => ({ ...prev, cropSquare }));
  }, [updateState]);

  // === Grid size ===

  const setGridSize = useCallback((size: 3 | 4 | 5) => {
    updateState(prev => {
      if (prev.gridSize === size) return prev;
      const newTotal = size * size;
      const newCells = [...prev.cells];
      const newItemMap = { ...prev.itemMap };

      if (newTotal < newCells.length) {
        // Shrinking — remove items from truncated cells
        for (let i = newTotal; i < newCells.length; i++) {
          const itemId = newCells[i];
          if (itemId && newItemMap[itemId]) {
            // Check if this item appears in the surviving cells or pool
            const stillExists = newCells.slice(0, newTotal).includes(itemId) || prev.pool.includes(itemId);
            if (!stillExists) delete newItemMap[itemId];
          }
        }
        newCells.length = newTotal;
      } else {
        // Growing — pad with nulls
        while (newCells.length < newTotal) newCells.push(null);
      }

      return { ...prev, gridSize: size, cells: newCells, itemMap: newItemMap };
    });
  }, [updateState]);

  // === Cell management ===

  const setCellItem = useCallback((index: number, item: GridItem) => {
    updateState(prev => {
      // Reject duplicates
      if (prev.cells.includes(item.id)) return prev;
      if (index < 0 || index >= prev.cells.length) return prev;

      const newCells = [...prev.cells];
      const newItemMap = { ...prev.itemMap };

      // Remove old item from this cell if occupied
      const oldId = newCells[index];
      if (oldId) {
        const stillUsed = newCells.some((id, i) => i !== index && id === oldId);
        if (!stillUsed) delete newItemMap[oldId];
      }

      newCells[index] = item.id;
      newItemMap[item.id] = { ...item, defaultImageUrl: item.defaultImageUrl ?? item.imageUrl };

      return { ...prev, cells: newCells, itemMap: newItemMap };
    });
  }, [updateState]);

  const updateItem = useCallback((itemId: string, updates: Partial<Pick<GridItem, 'cropData' | 'cropPreview' | 'cropPreviewTiny' | 'customTitle' | 'vote' | 'imageUrl' | 'imageSexual'>>) => {
    updateState(prev => {
      if (!prev.itemMap[itemId]) return prev;
      return {
        ...prev,
        itemMap: { ...prev.itemMap, [itemId]: { ...prev.itemMap[itemId], ...updates } },
      };
    });
  }, [updateState]);

  const removeCellItem = useCallback((index: number) => {
    updateState(prev => {
      const itemId = prev.cells[index];
      if (!itemId) return prev;

      const newCells = [...prev.cells];
      newCells[index] = null;

      const newItemMap = { ...prev.itemMap };
      const stillUsed = newCells.includes(itemId) || prev.pool.includes(itemId);
      if (!stillUsed) delete newItemMap[itemId];

      return { ...prev, cells: newCells, itemMap: newItemMap };
    });
  }, [updateState]);

  const getNextEmptyCell = useCallback((): number | null => {
    const idx = state.cells.indexOf(null);
    return idx >= 0 ? idx : null;
  }, [state.cells]);

  const isItemAdded = useCallback((itemId: string) => {
    return state.cells.includes(itemId) || state.pool.includes(itemId);
  }, [state.cells, state.pool]);

  // === Pool management ===

  const addToPool = useCallback((item: GridItem) => {
    updateState(prev => {
      // Reject duplicates (check both cells and pool)
      if (prev.cells.includes(item.id) || prev.pool.includes(item.id)) return prev;
      const withDefault = { ...item, defaultImageUrl: item.defaultImageUrl ?? item.imageUrl };
      return {
        ...prev,
        pool: [...prev.pool, item.id],
        itemMap: { ...prev.itemMap, [item.id]: withDefault },
      };
    });
  }, [updateState]);

  const removeFromPool = useCallback((itemId: string) => {
    updateState(prev => {
      if (!prev.pool.includes(itemId)) return prev;
      const newPool = prev.pool.filter(id => id !== itemId);
      const newItemMap = { ...prev.itemMap };
      const stillUsed = prev.cells.includes(itemId);
      if (!stillUsed) delete newItemMap[itemId];
      return { ...prev, pool: newPool, itemMap: newItemMap };
    });
  }, [updateState]);

  const moveToPool = useCallback((index: number) => {
    updateState(prev => {
      const itemId = prev.cells[index];
      if (!itemId) return prev;
      const newCells = [...prev.cells];
      newCells[index] = null;
      // Don't add to pool if already there (shouldn't happen, but be safe)
      const newPool = prev.pool.includes(itemId) ? prev.pool : [...prev.pool, itemId];
      return { ...prev, cells: newCells, pool: newPool };
    });
  }, [updateState]);

  // === DnD handlers (swap semantics with pool support) ===

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);
    let itemId: string | null = null;

    if (id.startsWith('pool-')) {
      itemId = id.replace('pool-', '');
    } else if (id.startsWith('cell-')) {
      const index = parseInt(id.replace('cell-', ''), 10);
      itemId = state.cells[index] ?? null;
    }
    setActiveId(itemId);
  }, [state.cells]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    updateState(prev => {
      if (!over || active.id === over.id) return prev;

      const activeStr = String(active.id);
      const overStr = String(over.id);

      const fromPool = activeStr.startsWith('pool-');
      const fromCell = activeStr.startsWith('cell-');
      const toPool = overStr === 'pool-drop' || overStr.startsWith('pool-');
      const toCell = overStr.startsWith('cell-');

      if (fromPool && toPool) {
        // Pool → Pool: reorder within pool
        const fromItemId = activeStr.replace('pool-', '');
        const toItemId = overStr.replace('pool-', '');
        const fromIdx = prev.pool.indexOf(fromItemId);
        const toIdx = overStr === 'pool-drop' ? prev.pool.length : prev.pool.indexOf(toItemId);
        if (fromIdx === -1 || toIdx === -1) return prev;
        return { ...prev, pool: arrayMove(prev.pool, fromIdx, toIdx) };
      }

      if (fromPool && toCell) {
        // Pool → Cell
        const itemId = activeStr.replace('pool-', '');
        const cellIndex = parseInt(overStr.replace('cell-', ''), 10);
        if (isNaN(cellIndex) || cellIndex < 0 || cellIndex >= prev.cells.length) return prev;

        const newPool = prev.pool.filter(id => id !== itemId);
        const newCells = [...prev.cells];
        const occupant = newCells[cellIndex];

        if (occupant) {
          // Swap: pool item goes to cell, cell occupant goes to pool
          newPool.push(occupant);
        }
        newCells[cellIndex] = itemId;

        return { ...prev, cells: newCells, pool: newPool };
      }

      if (fromCell && toPool) {
        // Cell → Pool
        const cellIndex = parseInt(activeStr.replace('cell-', ''), 10);
        if (isNaN(cellIndex) || cellIndex < 0 || cellIndex >= prev.cells.length) return prev;
        const itemId = prev.cells[cellIndex];
        if (!itemId) return prev;

        const newCells = [...prev.cells];
        newCells[cellIndex] = null;
        const newPool = prev.pool.includes(itemId) ? prev.pool : [...prev.pool, itemId];

        return { ...prev, cells: newCells, pool: newPool };
      }

      if (fromCell && toCell) {
        // Cell → Cell: swap (existing behavior)
        const fromIndex = parseInt(activeStr.replace('cell-', ''), 10);
        const toIndex = parseInt(overStr.replace('cell-', ''), 10);

        if (isNaN(fromIndex) || isNaN(toIndex)) return prev;
        if (fromIndex < 0 || fromIndex >= prev.cells.length) return prev;
        if (toIndex < 0 || toIndex >= prev.cells.length) return prev;

        const newCells = [...prev.cells];
        const temp = newCells[fromIndex];
        newCells[fromIndex] = newCells[toIndex];
        newCells[toIndex] = temp;

        return { ...prev, cells: newCells };
      }

      return prev;
    });
  }, [updateState]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  // === VNDB import ===

  const importFromVNDB = useCallback((items: VNDBListItem[], toPool = false) => {
    const pref = readTitlePreference();
    updateState(prev => {
      const sorted = [...items].sort((a, b) => (b.vote ?? 0) - (a.vote ?? 0));
      const newItemMap: Record<string, GridItem> = {};

      if (toPool) {
        // All items go to pool
        const newPool: string[] = [];
        for (const item of sorted) {
          newPool.push(item.id);
          newItemMap[item.id] = vndbItemToGridItem(item, pref);
        }
        return { ...prev, pool: newPool, itemMap: newItemMap };
      }

      // Auto-fill grid, overflow goes to pool
      const total = prev.gridSize * prev.gridSize;
      const newCells: (string | null)[] = Array(total).fill(null);
      const newPool: string[] = [];

      for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        newItemMap[item.id] = vndbItemToGridItem(item, pref);
        if (i < total) {
          newCells[i] = item.id;
        } else {
          newPool.push(item.id);
        }
      }

      return { ...prev, cells: newCells, pool: newPool, itemMap: newItemMap };
    });
  }, [updateState]);

  const setImportedUser = useCallback((user: string | null) => {
    updateState(prev => ({ ...prev, importedUser: user }));
  }, [updateState]);

  const setGridTitle = useCallback((gridTitle: string) => {
    updateState(prev => ({ ...prev, gridTitle }));
  }, [updateState]);

  // === Share loading ===

  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const loadFromShare = useCallback(async (shareId: string): Promise<GridSharedSettings | null> => {
    setShareLoading(true);
    setShareError(null);
    try {
      const layout = await fetchSharedLayout(shareId);
      if (layout.type !== 'grid') {
        setShareError('Invalid share type');
        return null;
      }
      const data = layout.data as {
        mode?: string; gridSize?: number;
        cells?: (string | null)[]; gridTitle?: string;
        pool?: string[];
        settings?: GridSharedSettings;
        overrides?: Record<string, Record<string, unknown>>;
      };
      const mode = (data.mode === 'characters' ? 'characters' : 'vns') as GridMode;
      const gridSize = ([3, 4, 5].includes(data.gridSize ?? 3) ? data.gridSize : 3) as 3 | 4 | 5;
      const cells = data.cells ?? [];
      const gridTitle = data.gridTitle ?? '';
      const pool = data.pool ?? [];
      const settings = data.settings;
      const overrides = data.overrides;

      // Collect unique item IDs (from cells + pool)
      const cellIds = cells.filter((c): c is string => c !== null);
      const itemIds = [...new Set([...cellIds, ...pool])];
      const prefix = mode === 'characters' ? 'c' : 'v';
      const validIds = itemIds.filter(id => id.startsWith(prefix));

      // Fetch metadata
      const items = mode === 'characters'
        ? await fetchBatchCharacters(validIds)
        : await fetchBatchVNs(validIds);

      // Use shared title preference if available, otherwise fall back to localStorage
      const pref = settings?.titlePreference ?? readTitlePreference();
      const newItemMap: Record<string, GridItem> = {};
      for (const item of items) {
        const imageUrl = item.image_url
          ? getProxiedImageUrl(item.image_url, { width: 256, vnId: item.id })
          : null;
        const title = mode === 'characters'
          ? (pref === 'japanese' && item.title_jp ? item.title_jp : item.title)
          : getDisplayTitle({ title: item.title, title_jp: item.title_jp ?? undefined, title_romaji: item.title_romaji ?? undefined }, pref);
        newItemMap[item.id] = {
          id: item.id,
          title: title || item.id,
          titleJp: item.title_jp ?? undefined,
          titleRomaji: item.title_romaji ?? undefined,
          imageUrl,
          imageSexual: item.image_sexual ?? null,
          defaultImageUrl: imageUrl,
        };
      }

      // Merge overrides (custom titles, covers, crops, votes)
      if (overrides) {
        for (const [id, ov] of Object.entries(overrides)) {
          if (!newItemMap[id]) continue;
          const item = newItemMap[id];
          if (typeof ov.customTitle === 'string') item.customTitle = ov.customTitle;
          if (typeof ov.imageUrl === 'string') item.imageUrl = ov.imageUrl;
          if (typeof ov.imageSexual === 'number') item.imageSexual = ov.imageSexual;
          if (ov.cropData && typeof ov.cropData === 'object') item.cropData = ov.cropData as CropData;
          if (typeof ov.vote === 'number') item.vote = ov.vote;
        }
      }

      // Pad/trim cells to match grid size
      const total = gridSize * gridSize;
      const finalCells = cells.slice(0, total);
      while (finalCells.length < total) finalCells.push(null);

      const loadedState: GridMakerState = {
        mode,
        gridSize,
        cropSquare: settings?.cropSquare ?? true,
        cells: finalCells,
        pool: pool.filter(id => newItemMap[id]),
        itemMap: newItemMap,
        importedUser: null,
        gridTitle,
      };
      setState(loadedState);
      // Save to localStorage so user edits persist across refresh
      saveToStorage(loadedState);
      try { localStorage.setItem(SHARE_ID_KEY, shareId); } catch {}
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
    const fresh = buildEmptyState(state.gridSize);
    fresh.mode = state.mode;
    fresh.cropSquare = state.cropSquare;
    setState(fresh);
    saveToStorage(fresh);
  }, [state.gridSize, state.mode, state.cropSquare]);

  const itemCount = state.cells.filter(Boolean).length;

  return {
    mode: state.mode,
    gridSize: state.gridSize,
    cropSquare: state.cropSquare,
    cells: state.cells,
    pool: state.pool,
    itemMap: state.itemMap,
    activeId,
    importedUser: state.importedUser,
    gridTitle: state.gridTitle,
    hydrated,
    itemCount,

    // Mode
    setMode,

    // Grid
    setGridSize,
    setCropSquare,
    setCellItem,
    updateItem,
    removeCellItem,
    getNextEmptyCell,
    isItemAdded,

    // Pool
    addToPool,
    removeFromPool,
    moveToPool,

    // DnD
    handleDragStart,
    handleDragEnd,
    handleDragCancel,

    // Import
    importFromVNDB,
    setImportedUser,
    setGridTitle,
    clearAll,

    // Share
    loadFromShare,
    shareLoading,
    shareError,

    // Storage
    storageWarning,
    dismissStorageWarning: useCallback(() => setStorageWarning(false), []),
  };
}
