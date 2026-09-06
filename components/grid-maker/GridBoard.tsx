'use client';

import Link from '@/components/Link';
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
import { Upload, Trash2, Loader2, Download, Users, Monitor, Rows3, Dices, Square, RectangleVertical, Settings } from 'lucide-react';
import { useGridMakerState } from '@/hooks/useGridMakerState';
import { useGridExport } from '@/hooks/useGridExport';
import type { GridExportFormat, GridExportScale } from '@/hooks/useGridExport';
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
import { createSharedLayout, copyAsyncText } from '@/lib/shared-layout-api';
import { useLocale } from '@/lib/i18n/locale-context';
import { gridMakerStrings } from '@/lib/i18n/translations/grid-maker';
import { t } from '@/lib/i18n/types';

interface GridBoardProps {
  shareId?: string;
}

const GRID_SIZES = [3, 4, 5] as const;

export function GridBoard({ shareId }: GridBoardProps) {
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
    isAtCapacity,
    saveStatus,
  } = useGridMakerState(shareId);

  // i18n
  const locale = useLocale();
  const s = gridMakerStrings[locale];

  // Drop target highlight + cell size for drag overlay
  const [overId, setOverId] = useState<string | null>(null);
  const [dragCellWidth, setDragCellWidth] = useState(100);
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

  // Direct-add setting (lazy init from localStorage)
  const [directAdd, setDirectAdd] = useState(() => {
    try { return localStorage.getItem('grid-direct-add') === 'true'; }
    catch { return false; }
  });

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
  const [exportScale, setExportScale] = useState<GridExportScale>(2);
  const { exporting, exportAsImage, generateBlob } = useGridExport(gridSize, cells, itemMap, importedUser ?? '', mode, cropSquare, showFrame, showTitles, showScores, gridTitle, titleMaxH, exportScale, nsfwExportState);

  // Share: build payload with settings + overrides
  const buildShareData = useCallback(() => {
    // Read title preference from localStorage
    let titlePreference: 'romaji' | 'japanese' = 'romaji';
    try {
      const stored = localStorage.getItem('vn-title-preference');
      if (stored === 'japanese' || stored === 'romaji') titlePreference = stored;
    } catch { /* ignore */ }

    const settings = { cropSquare, showFrame, showTitles, showScores, titleMaxH, titlePreference };

    // Build sparse overrides: only items with user changes
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

  // Cached share URL: reuses existing link if data hasn't changed
  const lastShareRef = useRef<{ hash: string; url: string } | null>(null);
  const getShareUrl = useCallback(async () => {
    const data = buildShareData();
    const dataHash = JSON.stringify(data);
    if (lastShareRef.current?.hash === dataHash) return lastShareRef.current.url;
    const id = await createSharedLayout('grid', data);
    const url = `${window.location.origin}/3x3-maker/s/${id}/`;
    lastShareRef.current = { hash: dataHash, url };
    return url;
  }, [buildShareData]);
  const [exportFormat, setExportFormat] = useState<GridExportFormat>('jpeg');

  const imageShare = useImageShare({
    generateBlob,
    shareText,
    hashtags: shareHashtags,
    filename: `${mode === 'characters' ? 'char' : 'vn'}-${gridSize}x${gridSize}.png`,
    getShareUrl,
    title: gridTitle || undefined,
    exportFormat,
  });

  // Share link: "Copy Link" button handler
  const [creatingLink, setCreatingLink] = useState(false);
  const [linkToast, setLinkToast] = useState<string | null>(null);
  const [linkToastIsError, setLinkToastIsError] = useState(false);
  // One timer for the whole component: a replacement toast must not be dismissed by the
  // countdown that belonged to the message it replaced.
  const linkToastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showLinkToast = useCallback((msg: string, duration: number, isError = false) => {
    if (linkToastTimerRef.current) clearTimeout(linkToastTimerRef.current);
    setLinkToast(msg);
    setLinkToastIsError(isError);
    linkToastTimerRef.current = setTimeout(() => setLinkToast(null), duration);
  }, []);
  useEffect(() => () => {
    if (linkToastTimerRef.current) clearTimeout(linkToastTimerRef.current);
  }, []);
  const handleCreateLink = useCallback(async () => {
    if (itemCount === 0) return;
    setCreatingLink(true);

    // Start clipboard write SYNCHRONOUSLY in gesture context.
    // copyAsyncText registers the ClipboardItem promise before any await, preserving
    // the user gesture so mobile browsers allow the clipboard write.
    let shareError: string | null = null;
    const urlPromise = getShareUrl().catch((err: Error) => {
      shareError = err.message;
      throw err;
    });
    const result = await copyAsyncText(urlPromise).catch(() => null);
    if (!result) {
      const msg = shareError === 'rate_limited'
        ? s['share.rateLimited']
        : s['share.createFailed'];
      showLinkToast(msg, 4000, true);
      const { logReporter } = await import('@/lib/log-reporter');
      logReporter.error('Grid share creation failed', {
        component: 'GridBoard', gridSize, mode, itemCount, shareError,
      });
    } else if (result.copied) {
      showLinkToast(s['share.linkCopied'], 3000);
    } else {
      showLinkToast(result.text, 8000);
    }
    setCreatingLink(false);
  }, [getShareUrl, itemCount, gridSize, mode, s, showLinkToast]);

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

  // Handle adding an item from search bar (top bar, no target cell)
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
        if (!res.has_more || allItems.length >= 500) break;
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

  // Auto-load from share link (always fetch from API, cached via Redis)
  const shareLoadedRef = useRef(false);
  useEffect(() => {
    if (!shareId || !hydrated || shareLoadedRef.current) return;
    shareLoadedRef.current = true;
    loadFromShare(shareId).then(settings => {
      if (!settings) return;
      if (settings.showFrame != null) setShowFrame(settings.showFrame);
      if (settings.showTitles != null) setShowTitles(settings.showTitles);
      if (settings.showScores != null) setShowScores(settings.showScores);
      if (settings.titleMaxH != null) setTitleMaxH(settings.titleMaxH);
      // The payload also records the language its author read in, which is deliberately not
      // applied: the title language is a site-wide setting the visitor owns, and the board's
      // own items already carry the language the payload was built in.
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
        <div className="toy-panel mb-3 flex items-center gap-2 p-3 text-sm text-[color:var(--nezu)]">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Loading shared grid&hellip;
        </div>
      )}
      {shareError && (
        <div className="bw-alert mb-3 p-3 text-sm">
          {shareError}
        </div>
      )}


      {/* Search */}
      <div className="mb-2">
        <GridSearch
          mode={mode}
          onAdd={handleAddItem}
          isItemAdded={isItemAdded}
          isAtCapacity={isAtCapacity}
          inputRef={searchInputRef}
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-center gap-2 flex-wrap mb-3">
        {/* Content: Mode toggle */}
        <div className="rc-seg">
          <button
            onClick={() => handleModeSwitch('vns')}
            className={`rc-seg-item gap-1 ${mode === 'vns' ? 'rc-seg-item--on' : ''}`}
            title={s['toolbar.vnMode']}
          >
            <Monitor className="w-3 h-3" />
            <span className="hidden sm:inline">{s['toolbar.vns']}</span>
          </button>
          <button
            onClick={() => handleModeSwitch('characters')}
            className={`rc-seg-item gap-1 ${mode === 'characters' ? 'rc-seg-item--on' : ''}`}
            title={s['toolbar.charMode']}
          >
            <Users className="w-3 h-3" />
            <span className="hidden sm:inline">{s['toolbar.characters']}</span>
          </button>
        </div>

        <div className="toy-divider hidden sm:block" />

        {/* Grid: Size selector + Crop mode */}
        <div className="rc-seg">
          {GRID_SIZES.map(size => (
            <button
              key={size}
              onClick={() => handleGridSizeSwitch(size)}
              className={`rc-seg-item ${hydrated && gridSize === size ? 'rc-seg-item--on' : ''}`}
            >
              {size}x{size}
            </button>
          ))}
        </div>
        <div className="rc-seg">
          <button
            onClick={() => setCropSquare(true)}
            className={`rc-seg-item rc-seg-item--icon ${hydrated && cropSquare ? 'rc-seg-item--on' : ''}`}
            title={s['toolbar.squareCrop']}
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={() => setCropSquare(false)}
            className={`rc-seg-item rc-seg-item--icon ${hydrated && !cropSquare ? 'rc-seg-item--on' : ''}`}
            title={s['toolbar.coverAspect']}
          >
            <RectangleVertical className="w-3 h-3" />
          </button>
        </div>
        <div ref={settingsRef} className="relative">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className={`toy-btn ${settingsOpen ? 'toy-btn--on' : ''}`}
            title={s['export.displaySettings']}
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{s['export.displaySettings']}</span>
          </button>
          {settingsOpen && (
            <div className="toy-menu absolute right-0 top-full mt-1 z-50 w-52 p-3 space-y-2">
              <label className="toy-check-row">
                <input type="checkbox" checked={showFrame} onChange={e => setShowFrame(e.target.checked)} className="bw-check" />
                {s['settings.frame']}
              </label>
              <label className="toy-check-row">
                <input type="checkbox" checked={showScores} onChange={e => setShowScores(e.target.checked)} className="bw-check" />
                {s['settings.scores']}
              </label>
              <label className="toy-check-row">
                <input type="checkbox" checked={nsfwContext?.allRevealed ?? false} onChange={e => nsfwContext?.setAllRevealed(e.target.checked)} className="bw-check" />
                {s['settings.nsfw']}
              </label>
              <label className="toy-check-row">
                <input type="checkbox" checked={showTitles} onChange={e => setShowTitles(e.target.checked)} className="bw-check" />
                {s['settings.titles']}
              </label>
              <div className="border-t border-[color:var(--rule)]" />
              <label className="toy-check-row">
                <input type="checkbox" checked={directAdd} onChange={e => { setDirectAdd(e.target.checked); localStorage.setItem('grid-direct-add', String(e.target.checked)); }} className="bw-check" />
                {s['settings.directAdd']}
              </label>
              <div className="border-t border-[color:var(--rule)]" />
              <div className="flex items-center justify-between gap-2">
                <span className="toy-label">{s['settings.language']}</span>
                <div className="rc-seg">
                  <button
                    onClick={() => setPreference('romaji')}
                    className={`rc-seg-item ${preference === 'romaji' ? 'rc-seg-item--on' : ''}`}
                  >
                    EN
                  </button>
                  <button
                    onClick={() => setPreference('japanese')}
                    className={`rc-seg-item ${preference === 'japanese' ? 'rc-seg-item--on' : ''}`}
                  >
                    JP
                  </button>
                </div>
              </div>
              <div className="border-t border-[color:var(--rule)]" />
              <label className="toy-check-row">
                <span className="toy-label whitespace-nowrap">{s['settings.titleHeight']}</span>
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
                  className="toy-field toy-field--num w-12 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="toy-label">%</span>
              </label>
            </div>
          )}
        </div>

        <div className="toy-divider hidden sm:block" />

        {/* Data: Import + Clear */}
        {mode === 'vns' && (
          <button
            onClick={() => setShowImport(!showImport)}
            className={`toy-btn ${showImport ? 'toy-btn--on' : ''}`}
          >
            <Upload className="w-3.5 h-3.5" />
            {s['toolbar.import']}
          </button>
        )}
        <button
          onClick={() => {
            if (window.confirm(s['confirm.clearAll'])) {
              clearAll();
              const base = `/${locale === 'en' ? '' : locale + '/'}3x3-maker/`;
              if (window.location.pathname !== base || window.location.search) {
                history.replaceState(null, '', base);
              }
            }
          }}
          disabled={itemCount === 0 && pool.length === 0}
          className="toy-btn toy-btn--drop"
          title={s['toolbar.clear']}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{s['toolbar.clear']}</span>
        </button>

        <div className="toy-divider hidden sm:block" />

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
        <div className="toy-split">
          <button
            onClick={() => exportAsImage(exportFormat)}
            disabled={exporting || importing || itemCount === 0}
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{s['export.export']}</span>
          </button>
          <button
            onClick={() => setExportScale(exportScale === 1 ? 1.5 : exportScale === 1.5 ? 2 : 1)}
            disabled={exporting || importing || itemCount === 0}
            title={s['export.exportScale']}
          >
            {exportScale}x
          </button>
          <button
            onClick={() => setExportFormat(exportFormat === 'jpeg' ? 'png' : exportFormat === 'png' ? 'webp' : 'jpeg')}
            disabled={exporting || importing || itemCount === 0}
            title="Export format"
          >
            {exportFormat === 'jpeg' ? 'JPG' : exportFormat === 'png' ? 'PNG' : 'WebP'}
          </button>
        </div>
      </div>

      {/* VNDB import form */}
      {showImport && mode === 'vns' && (
        <div className="toy-panel mb-3 p-3">
          <form onSubmit={handleImport} className="flex gap-2">
            <input
              type="text"
              value={importInput}
              onChange={e => setImportInput(e.target.value)}
              placeholder={s['import.placeholder']}
              disabled={importing}
              className="toy-field flex-1 min-w-0"
            />
            <button
              type="submit"
              disabled={importing || !importInput.trim()}
              className="toy-btn toy-btn--go"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : s['import.button']}
            </button>
          </form>
          <div className="mt-2 flex items-center gap-4">
            <label className="toy-check-row">
              <input
                type="radio"
                name="importDest"
                checked={!importToPool}
                onChange={() => setImportToPool(false)}
                className="bw-check"
              />
              {s['import.autoFill']}
            </label>
            <label className="toy-check-row">
              <input
                type="radio"
                name="importDest"
                checked={importToPool}
                onChange={() => setImportToPool(true)}
                className="bw-check"
              />
              {s['import.toPool']}
            </label>
          </div>
          {importing && importProgress && (
            <p className="mt-2 text-xs text-[color:var(--nezu)]">{importProgress}</p>
          )}
          {importError && (
            <p className="mt-2 text-xs text-[color:var(--beni-text)]">{importError}</p>
          )}
        </div>
      )}

      {/* Grid */}
      <DndContext
        id="grid-maker-dnd"
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={(e) => {
          const rect = e.active.rect.current.initial;
          if (rect) setDragCellWidth(rect.width);
          handleDragStart(e);
        }}
        onDragOver={handleDragOver}
        onDragEnd={(e) => { setOverId(null); handleDragEnd(e); }}
        onDragCancel={() => { setOverId(null); handleDragCancel(); }}
      >
        <div className="mx-auto" style={{ maxWidth }}>
          {/* Title header: always visible, editable inline */}
          <div className="py-2.5">
            <input
              type="text"
              value={gridTitle}
              onChange={e => setGridTitle(e.target.value)}
              placeholder={s['export.titlePlaceholder']}
              maxLength={60}
              className="toy-title-field"
            />
          </div>

          <SortableContext items={cellIds} strategy={noMovementStrategy}>
            <div
              className={`grid ${showFrame ? 'gap-1' : 'gap-0'}`}
              style={{ gridTemplateColumns: `repeat(${gridSize}, 1fr)` }}
            >
              {cells.map((itemId, index) => (
                <GridCell
                  key={`cell-${index}`}
                  id={`cell-${index}`}
                  index={index}
                  gridSize={gridSize}
                  item={itemId ? itemMap[itemId] ?? null : null}
                  cropSquare={cropSquare}
                  showTitles={showTitles}
                  showScores={showScores}
                  titleMaxH={titleMaxH}
                  isDropTarget={activeId != null && overId === `cell-${index}`}
                  isTargeted={fillCellIndex === index}
                  nsfwRevealed={nsfwContext?.allRevealed ?? false}
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
          {activeId ? <GridDragOverlay item={itemMap[activeId]} cropSquare={cropSquare} previewUrl={cropPreviewMapRef.current[activeId]} cellWidth={dragCellWidth} nsfwRevealed={(nsfwContext?.allRevealed ?? false) || (nsfwContext?.isRevealed(activeId!) ?? false)} /> : null}
        </DragOverlay>
      </DndContext>

      <p className="mt-2 text-center font-mono text-xs tabular-nums text-[color:var(--nezu)]">
        {t(s, mode === 'characters' ? 'export.countChars' : 'export.countVNs', { count: itemCount, total: gridSize * gridSize })}
        {pool.length > 0 && ` + ${pool.length} ${s['pool.label'].toLowerCase()}`}
      </p>
      <p className="mt-1 text-center text-xs text-[color:var(--text-faint)]">
        {mode === 'characters' ? s['grid.hintChars'] : s['grid.hintVNs']}
      </p>
      {saveStatus && (
        <p className="mt-1 text-center font-mono text-[10px] text-[color:var(--text-faint)]">
          {saveStatus.type === 'saved'
            ? `${locale === 'ja' ? '最終自動保存' : 'Last autosaved'}: ${new Date(saveStatus.time).toLocaleTimeString(locale === 'ja' ? 'ja-JP' : 'en-US')}`
            : locale === 'ja' ? '下書きをクリアしました' : 'Draft cleared'}
        </p>
      )}

      <div className="mt-6 flex justify-center gap-4">
        <Link
          href={locale === 'ja' ? '/ja/tierlist/' : '/tierlist/'}
          className="toy-btn"
        >
          <Rows3 className="w-4 h-4" />
          {s['grid.tryTierList']}
        </Link>
        <Link
          href={locale === 'ja' ? '/ja/roulette/' : '/roulette/'}
          className="toy-btn"
        >
          <Dices className="w-4 h-4" />
          {s['grid.tryRoulette']}
        </Link>
      </div>

      {/* Cell fill modal: gated on what the cell renders, so a slot holding an id with no
          metadata behind it is still offered as empty and can be filled. */}
      {fillCellIndex !== null && !itemMap[cells[fillCellIndex] ?? ''] && (
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
      <ShareToast message={linkToast} isError={linkToastIsError} onDismiss={() => setLinkToast(null)} />

      {storageWarning && (
        <div className="toy-toast">
          <span className="flex-1">{s['storage.warning']}</span>
          <button onClick={dismissStorageWarning} className="toy-btn shrink-0">OK</button>
        </div>
      )}
    </div>
  );
}
