'use client';

import Link from 'next/link';
import { useRef, useState, useMemo, useEffect, useCallback, FormEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from '@dnd-kit/core';
import type { DragOverEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { SortingStrategy } from '@dnd-kit/sortable';

// No-op strategy: items stay in place during drag. Swap happens only on drop.
const noMovementStrategy: SortingStrategy = () => null;
import { Upload, Trash2, Loader2, Download, Users, Monitor, Rows3, Square, RectangleVertical, Settings } from 'lucide-react';
import { useGridMakerState } from '@/hooks/useGridMakerState';
import { useGridExport } from '@/hooks/useGridExport';
import type { GridExportFormat } from '@/hooks/useGridExport';
import { useImageShare } from '@/hooks/useImageShare';
import { ShareMenu } from '@/components/shared/ShareMenu';
import { ShareToast } from '@/components/shared/ShareToast';
import { useTitlePreference } from '@/lib/title-preference';
import { useNSFWRevealContext } from '@/lib/nsfw-reveal';
import { GridCell } from './GridCell';
import { GridDragOverlay } from './GridDragOverlay';
import { GridPool } from './GridPool';
import { GridSearch } from './GridSearch';
import { CellFillModal } from './CellFillModal';
import dynamic from 'next/dynamic';
const CropModal = dynamic(() => import('./CropModal').then(m => ({ default: m.CropModal })), { ssr: false });
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { VNDBListItem } from '@/lib/vndb-stats-api';
import type { GridItem, CropData } from '@/hooks/useGridMakerState';
import { getLoadedShareId } from '@/lib/grid-share-id';
import { createSharedLayout, copyAsyncText } from '@/lib/shared-layout-api';
import { useLocale } from '@/lib/i18n/locale-context';
import { gridMakerStrings } from '@/lib/i18n/translations/grid-maker';
import { t } from '@/lib/i18n/types';

interface GridBoardProps {
  urlParams?: { user: string } | null;
  shareId?: string;
}

const GRID_SIZES = [3, 4, 5] as const;

export function GridBoard({ urlParams, shareId }: GridBoardProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cropPreviewMapRef = useRef<Record<string, string>>({});

  const {
    mode,
    gridSize,
    cropSquare,
    cells,
    pool,
    itemMap,
    activeId,
    importedUser,
    hydrated,
    itemCount,
    setMode,
    setGridSize,
    setCropSquare,
    setCellItem,
    updateItem,
    removeCellItem,
    getNextEmptyCell,
    isItemAdded,
    addToPool,
    removeFromPool,
    moveToPool,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    importFromVNDB,
    setImportedUser,
    gridTitle,
    setGridTitle,
    clearAll,
    loadFromShare,
    shareLoading,
    shareError,
    storageWarning,
    dismissStorageWarning,
  } = useGridMakerState(shareId);

  // i18n
  const locale = useLocale();
  const s = gridMakerStrings[locale];

  // Drop target highlight
  const [overId, setOverId] = useState<string | null>(null);
  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverId(event.over ? String(event.over.id) : null);
  }, []);

  // Settings hooks
  const { preference, setPreference } = useTitlePreference();
  const nsfwContext = useNSFWRevealContext();

  // Export state
  const [showFrame, setShowFrame] = useState(false);
  const [showTitles, setShowTitles] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const [titleMaxH, setTitleMaxH] = useState(40);

  // Direct-add setting
  const [directAdd, setDirectAdd] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem('grid-direct-add');
    if (stored === 'true') setDirectAdd(true);
  }, []);

  // Settings dropdown
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSettingsOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen]);

  const nsfwExportState = useMemo(() =>
    nsfwContext ? { allRevealed: nsfwContext.allRevealed, isRevealed: nsfwContext.isRevealed } : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nsfwContext?.allRevealed, nsfwContext?.isRevealed]
  );
  const { exporting, exportAsImage, generateBlob } = useGridExport(gridSize, cells, itemMap, importedUser ?? '', mode, cropSquare, showFrame, showTitles, showScores, gridTitle, titleMaxH, nsfwExportState);

  // Share — build payload with settings + overrides
  const buildShareData = useCallback(() => {
    // Read title preference from localStorage
    let titlePreference: 'romaji' | 'japanese' = 'romaji';
    try {
      const stored = localStorage.getItem('vn-title-preference');
      if (stored === 'japanese' || stored === 'romaji') titlePreference = stored;
    } catch { /* ignore */ }

    const settings = { cropSquare, showFrame, showTitles, showScores, titleMaxH, titlePreference };

    // Build sparse overrides — only items with user changes
    const overrides: Record<string, Record<string, unknown>> = {};
    for (const [id, item] of Object.entries(itemMap)) {
      const o: Record<string, unknown> = {};
      if (item.customTitle) o.customTitle = item.customTitle;
      if (item.imageUrl && item.defaultImageUrl && item.imageUrl !== item.defaultImageUrl) {
        o.imageUrl = item.imageUrl;
        if (item.imageSexual != null) o.imageSexual = item.imageSexual;
      }
      if (item.cropData) o.cropData = item.cropData;
      if (item.vote != null) o.vote = item.vote;
      if (Object.keys(o).length > 0) overrides[id] = o;
    }

    return { mode, gridSize, cells, gridTitle, pool, settings, overrides };
  }, [mode, gridSize, cells, gridTitle, pool, cropSquare, showFrame, showTitles, showScores, titleMaxH, itemMap]);

  const shareText = t(s, 'export.shareText', { size: gridSize, mode: mode === 'characters' ? s['export.shareTextChar'] : '' });
  const shareHashtags = s['export.shareHashtags'];
  const getShareUrl = useCallback(async () => {
    const id = await createSharedLayout('grid', buildShareData());
    return `${window.location.origin}/3x3-maker/s/${id}/`;
  }, [buildShareData]);
  const imageShare = useImageShare({
    generateBlob,
    shareText,
    hashtags: shareHashtags,
    filename: `${mode === 'characters' ? 'char' : 'vn'}-${gridSize}x${gridSize}.png`,
    getShareUrl,
    title: gridTitle || undefined,
  });

  const [exportFormat, setExportFormat] = useState<GridExportFormat>('jpeg');

  // Share link — cache last share to avoid creating duplicate links
  const [creatingLink, setCreatingLink] = useState(false);
  const [linkToast, setLinkToast] = useState<string | null>(null);
  const lastShareRef = useRef<{ hash: string; url: string } | null>(null);
  const handleCreateLink = useCallback(async () => {
    if (itemCount === 0) return;
    setCreatingLink(true);
    const data = buildShareData();
    const dataHash = JSON.stringify(data);

    // Reuse existing link if data hasn't changed
    if (lastShareRef.current?.hash === dataHash) {
      const url = lastShareRef.current.url;
      const urlPromise = Promise.resolve(url);
      const result = await copyAsyncText(urlPromise).catch(() => null);
      if (result?.copied) {
        setLinkToast('Link copied!');
        setTimeout(() => setLinkToast(null), 3000);
      } else {
        setLinkToast(url);
        setTimeout(() => setLinkToast(null), 8000);
      }
      setCreatingLink(false);
      return;
    }

    // Build share data and start clipboard write SYNCHRONOUSLY in gesture context.
    // copyAsyncText registers the ClipboardItem promise before any await, preserving
    // the user gesture so mobile browsers allow the clipboard write.
    let shareError: string | null = null;
    const urlPromise = createSharedLayout('grid', data)
      .then(id => {
        const url = `${window.location.origin}/3x3-maker/s/${id}/`;
        lastShareRef.current = { hash: dataHash, url };
        return url;
      })
      .catch((err: Error) => {
        shareError = err.message;
        throw err;
      });
    const result = await copyAsyncText(urlPromise).catch(() => null);
    if (!result) {
      const msg = shareError === 'rate_limited'
        ? 'Too many requests - please wait a minute'
        : 'Failed to create link';
      setLinkToast(msg);
      setTimeout(() => setLinkToast(null), 4000);
      const { logReporter } = await import('@/lib/log-reporter');
      logReporter.error('Grid share creation failed', {
        component: 'GridBoard', gridSize, mode, itemCount, shareError,
      });
    } else if (result.copied) {
      setLinkToast('Link copied!');
      setTimeout(() => setLinkToast(null), 3000);
    } else {
      setLinkToast(result.text);
      setTimeout(() => setLinkToast(null), 8000);
    }
    setCreatingLink(false);
  }, [buildShareData, itemCount, gridSize, mode]);

  // VNDB import state
  const [showImport, setShowImport] = useState(false);
  const [importInput, setImportInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importProgress, setImportProgress] = useState('');

  // Import destination
  const [importToPool, setImportToPool] = useState(false);

  // Crop modal
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Cell fill modal (click empty cell → modal with search + pool)
  const [fillCellIndex, setFillCellIndex] = useState<number | null>(null);

  // Handle adding an item from search bar (top bar — no target cell)
  const handleAddItem = useCallback((item: GridItem) => {
    if (directAdd) {
      const nextEmpty = getNextEmptyCell();
      if (nextEmpty !== null) {
        setCellItem(nextEmpty, item);
        return;
      }
    }
    addToPool(item);
  }, [addToPool, directAdd, getNextEmptyCell, setCellItem]);

  // Handle selecting an item in the cell fill modal
  const handleModalSelect = useCallback((item: GridItem) => {
    if (fillCellIndex !== null) {
      setCellItem(fillCellIndex, item);
      setFillCellIndex(null);
    }
  }, [fillCellIndex, setCellItem]);

  // Handle selecting a pool item in the cell fill modal
  const handleModalPoolSelect = useCallback((itemId: string) => {
    if (fillCellIndex !== null) {
      // Move from pool to the target cell
      removeFromPool(itemId);
      const item = itemMap[itemId];
      if (item) setCellItem(fillCellIndex, item);
      setFillCellIndex(null);
    }
  }, [fillCellIndex, setCellItem, removeFromPool, itemMap]);

  // Crop modal handlers
  const handleCropEdit = useCallback((index: number) => {
    const itemId = cells[index];
    if (itemId) setEditingItemId(itemId);
  }, [cells]);

  const handlePoolEdit = useCallback((itemId: string) => {
    setEditingItemId(itemId);
  }, []);

  const handleEditSave = useCallback((data: { cropData?: CropData; cropPreview?: string; cropPreviewTiny?: string; customTitle?: string; vote?: number; imageUrl?: string; imageSexual?: number }) => {
    if (editingItemId) {
      updateItem(editingItemId, {
        cropData: data.cropData,
        cropPreview: data.cropPreview,
        cropPreviewTiny: data.cropPreviewTiny,
        customTitle: data.customTitle,
        vote: data.vote,
        ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl, imageSexual: data.imageSexual ?? null } : {}),
      });
    }
    setEditingItemId(null);
  }, [editingItemId, updateItem]);

  // VNDB import
  const runImport = useCallback(async (username: string) => {
    setImporting(true);
    setImportError('');
    setImportProgress(s['import.lookingUp']);

    try {
      const user = await vndbStatsApi.lookupUser(username);
      if (!user) {
        setImportError(t(s, 'import.userNotFound', { username }));
        return false;
      }

      const allItems: VNDBListItem[] = [];
      let page = 1;

      while (true) {
        setImportProgress(t(s, 'import.fetchingPage', { page }));
        const res = await vndbStatsApi.getUserVNList(user.uid, page, 100);
        allItems.push(...res.items);
        if (!res.has_more || allItems.length >= 2000) break;
        page++;
      }

      const scored = allItems.filter(item => item.vn?.title && item.vote);
      if (scored.length === 0) {
        setImportError(s['import.noScored']);
        return false;
      }

      importFromVNDB(scored, importToPool);
      setImportedUser(username);
      return true;
    } catch (err) {
      setImportError(err instanceof Error ? err.message : s['import.failed']);
      return false;
    } finally {
      setImporting(false);
      setImportProgress('');
    }
  }, [importFromVNDB, setImportedUser, importToPool]);

  // Auto-import from URL params (skip if localStorage already has this user's data)
  const autoImportedRef = useRef(false);
  useEffect(() => {
    if (!hydrated || !urlParams?.user || autoImportedRef.current) return;
    if (importedUser === urlParams.user) return;
    autoImportedRef.current = true;
    runImport(urlParams.user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Auto-load from share link
  const shareLoadedRef = useRef(false);
  useEffect(() => {
    if (!shareId || !hydrated || shareLoadedRef.current) return;
    shareLoadedRef.current = true;
    // If we previously loaded this shareId, localStorage has the (possibly edited) state — skip re-fetch
    if (getLoadedShareId() === shareId) return;
    loadFromShare(shareId).then(settings => {
      if (!settings) return;
      if (settings.showFrame != null) setShowFrame(settings.showFrame);
      if (settings.showTitles != null) setShowTitles(settings.showTitles);
      if (settings.showScores != null) setShowScores(settings.showScores);
      if (settings.titleMaxH != null) setTitleMaxH(settings.titleMaxH);
      if (settings.titlePreference) setPreference(settings.titlePreference);
    });
  }, [shareId, hydrated, loadFromShare]);

  const handleImport = async (e: FormEvent) => {
    e.preventDefault();
    const value = importInput.trim();
    if (!value) return;

    if (itemCount > 0 && !window.confirm(s['import.confirmReplace'])) return;

    const ok = await runImport(value);
    if (ok) {
      setShowImport(false);
      setImportInput('');
    }
  };

  // URL sync
  useEffect(() => {
    const url = new URL(window.location.href);
    if (importedUser) {
      url.searchParams.set('user', importedUser);
    } else {
      url.searchParams.delete('user');
    }
    if (url.href !== window.location.href) {
      history.replaceState(null, '', url);
    }
  }, [importedUser]);

  // Mode switch with confirmation
  const handleModeSwitch = useCallback((newMode: typeof mode) => {
    if (newMode === mode) return;
    if (itemCount > 0 && !window.confirm(s['confirm.modeSwitch'])) return;
    setMode(newMode);
  }, [mode, itemCount, setMode]);

  // Grid size switch with confirmation
  const handleGridSizeSwitch = useCallback((newSize: 3 | 4 | 5) => {
    if (newSize === gridSize) return;
    if (newSize < gridSize) {
      const wouldLose = cells.slice(newSize * newSize).some(Boolean);
      if (wouldLose && !window.confirm(s['confirm.gridShrink'])) return;
    }
    setGridSize(newSize);
  }, [gridSize, cells, setGridSize]);

  const cellIds = useMemo(() => cells.map((_, i) => `cell-${i}`), [cells]);

  const maxWidth = gridSize === 3 ? 420 : gridSize === 4 ? 520 : 600;

  return (
    <div>
      {/* Share loading banner */}
      {shareLoading && (
        <div className="mb-3 p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg flex items-center gap-2 text-sm text-purple-700 dark:text-purple-300">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Loading shared grid&hellip;
        </div>
      )}
      {shareError && (
        <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {shareError}
        </div>
      )}

      {/* Auto-import loading banner */}
      {importing && urlParams?.user && (
        <div className="mb-3 p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg flex items-center gap-2 text-sm text-purple-700 dark:text-purple-300">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          {t(s, 'import.loadingBanner', { user: urlParams.user })}
          {importProgress && <span className="text-purple-500 dark:text-purple-400">({importProgress})</span>}
        </div>
      )}

      {/* Search */}
      <div className="mb-2">
        <GridSearch
          mode={mode}
          onAdd={handleAddItem}
          isItemAdded={isItemAdded}
          inputRef={searchInputRef}
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-center gap-2 flex-wrap mb-3">
        {/* Content: Mode toggle */}
        <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <button
            onClick={() => handleModeSwitch('vns')}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1 ${
              mode === 'vns'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={s['toolbar.vnMode']}
          >
            <Monitor className="w-3 h-3" />
            <span className="hidden sm:inline">{s['toolbar.vns']}</span>
          </button>
          <button
            onClick={() => handleModeSwitch('characters')}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1 ${
              mode === 'characters'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={s['toolbar.charMode']}
          >
            <Users className="w-3 h-3" />
            <span className="hidden sm:inline">{s['toolbar.characters']}</span>
          </button>
        </div>

        <div className="hidden sm:block h-6 w-px bg-gray-200 dark:bg-gray-700" />

        {/* Grid: Size selector + Crop mode */}
        <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {GRID_SIZES.map(size => (
            <button
              key={size}
              onClick={() => handleGridSizeSwitch(size)}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                hydrated && gridSize === size
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {size}x{size}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <button
            onClick={() => setCropSquare(true)}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1 ${
              hydrated && cropSquare
                ? 'bg-purple-600 text-white'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={s['toolbar.squareCrop']}
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={() => setCropSquare(false)}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1 ${
              hydrated && !cropSquare
                ? 'bg-purple-600 text-white'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={s['toolbar.coverAspect']}
          >
            <RectangleVertical className="w-3 h-3" />
          </button>
        </div>
        <div ref={settingsRef} className="relative">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className={`p-1.5 rounded-lg transition-colors ${
              settingsOpen
                ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                : 'text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-300'
            }`}
            title={s['export.displaySettings']}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          {settingsOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={showFrame} onChange={e => setShowFrame(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500" />
                {s['settings.frame']}
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={showScores} onChange={e => setShowScores(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500" />
                {s['settings.scores']}
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={nsfwContext?.allRevealed ?? false} onChange={e => nsfwContext?.setAllRevealed(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500" />
                {s['settings.nsfw']}
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={showTitles} onChange={e => setShowTitles(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500" />
                {s['settings.titles']}
              </label>
              <div className="border-t border-gray-100 dark:border-gray-700" />
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={directAdd} onChange={e => { setDirectAdd(e.target.checked); localStorage.setItem('grid-direct-add', String(e.target.checked)); }} className="rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500" />
                {s['settings.directAdd']}
              </label>
              <div className="border-t border-gray-100 dark:border-gray-700" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600 dark:text-gray-300">{s['settings.language']}</span>
                <div className="inline-flex items-center rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <button
                    onClick={() => setPreference('romaji')}
                    className={`px-2 py-1 text-xs font-medium transition-colors ${
                      preference === 'romaji'
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    EN
                  </button>
                  <button
                    onClick={() => setPreference('japanese')}
                    className={`px-2 py-1 text-xs font-medium transition-colors ${
                      preference === 'japanese'
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    JP
                  </button>
                </div>
              </div>
              <div className="border-t border-gray-100 dark:border-gray-700" />
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <span className="whitespace-nowrap">{s['settings.titleHeight']}</span>
                <input
                  type="number"
                  min={10}
                  max={100}
                  defaultValue={titleMaxH}
                  key={titleMaxH}
                  onBlur={e => {
                    const v = Math.min(100, Math.max(10, Number(e.target.value) || 40));
                    setTitleMaxH(v);
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  className="w-12 px-1 py-0.5 text-xs text-center rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:ring-1 focus:ring-purple-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span>%</span>
              </label>
            </div>
          )}
        </div>

        <div className="hidden sm:block h-6 w-px bg-gray-200 dark:bg-gray-700" />

        {/* Data: Import + Clear */}
        {mode === 'vns' && (
          <button
            onClick={() => setShowImport(!showImport)}
            className="inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{s['toolbar.import']}</span>
          </button>
        )}
        <button
          onClick={() => { if (window.confirm(s['confirm.clearAll'])) clearAll(); }}
          disabled={itemCount === 0 && pool.length === 0}
          className="inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={s['toolbar.clear']}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{s['toolbar.clear']}</span>
        </button>

        <div className="hidden sm:block h-6 w-px bg-gray-200 dark:bg-gray-700" />

        {/* Export: Share + Copy + Export */}
        <ShareMenu
          onShare={imageShare.share}
          sharing={imageShare.sharing}
          canNativeShare={imageShare.canNativeShare}
          disabled={itemCount === 0 || importing}
          onCreateLink={handleCreateLink}
          creatingLink={creatingLink}
          onOpen={imageShare.prepareBlob}
        />
        <div className="inline-flex items-stretch">
          <button
            onClick={() => exportAsImage(exportFormat)}
            disabled={exporting || importing || itemCount === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-l-lg transition-colors"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{s['export.export']}</span>
          </button>
          <select
            value={exportFormat}
            onChange={e => setExportFormat(e.target.value as GridExportFormat)}
            disabled={exporting || importing || itemCount === 0}
            className="text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed border-l border-purple-500 rounded-r-lg px-2 cursor-pointer transition-colors appearance-none text-center"
            aria-label="Export format"
          >
            <option value="jpeg">JPG</option>
            <option value="png">PNG</option>
            <option value="webp">WebP</option>
          </select>
        </div>
      </div>

      {/* VNDB import form */}
      {showImport && mode === 'vns' && (
        <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
          <form onSubmit={handleImport} className="flex gap-2">
            <input
              type="text"
              value={importInput}
              onChange={e => setImportInput(e.target.value)}
              placeholder={s['import.placeholder']}
              disabled={importing}
              className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-1 focus:ring-purple-500"
            />
            <button
              type="submit"
              disabled={importing || !importInput.trim()}
              className="px-4 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : s['import.button']}
            </button>
          </form>
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="importDest"
                checked={!importToPool}
                onChange={() => setImportToPool(false)}
                className="text-purple-600 focus:ring-purple-500"
              />
              {s['import.autoFill']}
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="importDest"
                checked={importToPool}
                onChange={() => setImportToPool(true)}
                className="text-purple-600 focus:ring-purple-500"
              />
              {s['import.toPool']}
            </label>
          </div>
          {importing && importProgress && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{importProgress}</p>
          )}
          {importError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{importError}</p>
          )}
        </div>
      )}

      {/* Grid */}
      <DndContext
        id="grid-maker-dnd"
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={(e) => { setOverId(null); handleDragEnd(e); }}
        onDragCancel={() => { setOverId(null); handleDragCancel(); }}
      >
        <div className="mx-auto" style={{ maxWidth }}>
          {/* Title header — always visible, editable inline */}
          <div className="py-2.5">
            <input
              type="text"
              value={gridTitle}
              onChange={e => setGridTitle(e.target.value)}
              placeholder={s['export.titlePlaceholder']}
              maxLength={60}
              className="w-full text-base font-bold text-center bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 outline-none"
            />
          </div>

          <SortableContext items={cellIds} strategy={noMovementStrategy}>
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${gridSize}, 1fr)` }}
            >
              {cells.map((itemId, index) => (
                <GridCell
                  key={`cell-${index}`}
                  id={`cell-${index}`}
                  index={index}
                  item={itemId ? itemMap[itemId] ?? null : null}
                  cropSquare={cropSquare}
                  showTitles={showTitles}
                  showScores={showScores}
                  titleMaxH={titleMaxH}
                  isDropTarget={activeId != null && overId === `cell-${index}`}
                  isTargeted={fillCellIndex === index}
                  onCellClick={() => setFillCellIndex(index)}
                  onRemove={() => moveToPool(index)}
                  onCropEdit={() => handleCropEdit(index)}
                  cropPreviewMap={cropPreviewMapRef}
                />
              ))}
            </div>
          </SortableContext>
        </div>

        <GridPool
          pool={pool}
          itemMap={itemMap}
          mode={mode}
          cropSquare={cropSquare}
          activeDrag={activeId !== null}
          onRemove={removeFromPool}
          onEdit={handlePoolEdit}
        />

        <DragOverlay dropAnimation={null}>
          {activeId ? <GridDragOverlay item={itemMap[activeId]} cropSquare={cropSquare} previewUrl={cropPreviewMapRef.current[activeId]} /> : null}
        </DragOverlay>
      </DndContext>

      <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
        {t(s, mode === 'characters' ? 'export.countChars' : 'export.countVNs', { count: itemCount, total: gridSize * gridSize })}
        {pool.length > 0 && ` + ${pool.length} ${s['pool.label'].toLowerCase()}`}
      </p>
      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 text-center">
        {mode === 'characters' ? s['grid.hintChars'] : s['grid.hintVNs']}
      </p>

      <div className="mt-6 flex justify-center">
        <Link
          href={locale === 'ja' ? '/ja/tierlist' : '/tierlist'}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
        >
          <Rows3 className="w-4 h-4" />
          {s['grid.tryTierList']}
        </Link>
      </div>

      {/* How it works */}
      <div className="mt-10 max-w-3xl mx-auto space-y-6 text-sm text-gray-600 dark:text-gray-400">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{s['howItWorks.title']}</h2>

        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-1">{s['howItWorks.adding.title']}</h3>
            <p>{s['howItWorks.adding.body']}</p>
          </div>

          <div>
            <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-1">{s['howItWorks.gridSize.title']}</h3>
            <p>{s['howItWorks.gridSize.body']}</p>
          </div>

          <div>
            <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-1">{s['howItWorks.cropping.title']}</h3>
            <p>{s['howItWorks.cropping.body']}</p>
          </div>

          <div>
            <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-1">{s['howItWorks.titles.title']}</h3>
            <p>{s['howItWorks.titles.body']}</p>
          </div>

          <div>
            <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-1">{s['howItWorks.exporting.title']}</h3>
            <p>{s['howItWorks.exporting.body']}</p>
          </div>

          <div>
            <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-1">{s['howItWorks.autoSave.title']}</h3>
            <p>{s['howItWorks.autoSave.body']}</p>
          </div>
        </div>
      </div>

      {/* Cell fill modal */}
      {fillCellIndex !== null && !cells[fillCellIndex] && (
        <CellFillModal
          cellIndex={fillCellIndex}
          mode={mode}
          pool={pool}
          cells={cells}
          itemMap={itemMap}
          onSelect={handleModalSelect}
          onSelectFromPool={handleModalPoolSelect}
          onClose={() => setFillCellIndex(null)}
        />
      )}

      {/* Edit modal */}
      {editingItemId && itemMap[editingItemId] && (
        <CropModal
          item={itemMap[editingItemId]}
          cropSquare={cropSquare}
          onSave={handleEditSave}
          onCancel={() => setEditingItemId(null)}
        />
      )}


      <ShareToast message={imageShare.toastMessage} isError={imageShare.toastIsError} onDismiss={imageShare.dismissToast} />
      <ShareToast message={linkToast} isError={linkToast === 'Failed to create link' || linkToast === 'Too many requests - please wait a minute'} onDismiss={() => setLinkToast(null)} />

      {storageWarning && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md px-4 py-3 rounded-lg bg-amber-100 dark:bg-amber-900/80 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-sm shadow-lg flex items-center gap-2">
          <span className="flex-1">{s['storage.warning']}</span>
          <button onClick={dismissStorageWarning} className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 font-medium shrink-0">OK</button>
        </div>
      )}
    </div>
  );
}
