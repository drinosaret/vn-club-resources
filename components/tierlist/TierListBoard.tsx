'use client';

import React, { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import Link from 'next/link';
import { Upload, Trash2, Loader2, Image as ImageIcon, AlignJustify, Grid3X3, Monitor, Users, Settings, ChevronDown, Square, RectangleVertical } from 'lucide-react';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';
import { t } from '@/lib/i18n/types';
import { useTierListState } from '@/hooks/useTierListState';
import { useTierDrag } from '@/hooks/useTierDrag';
import { TierRow } from './TierRow';
import { TierPool } from './TierPool';
import { TierListControls } from './TierListControls';
import { TierSearchAdd } from './TierSearchAdd';
import dynamic from 'next/dynamic';
const VNEditModal = dynamic(() => import('./VNEditModal').then(m => ({ default: m.VNEditModal })), { ssr: false });
const TierRowFillModal = dynamic(() => import('./TierRowFillModal').then(m => ({ default: m.TierRowFillModal })), { ssr: false });
import { VnMapProvider } from './VnMapContext';
import { EMPTY_STRING_ARRAY } from '@/lib/tier-config';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { VNDBListItem } from '@/lib/vndb-stats-api';
import { useTitlePreference } from '@/lib/title-preference';
import { useNSFWRevealContext } from '@/lib/nsfw-reveal';
import { TIER_PRESETS, getPresetById, getCurrentPresetId, getSizeConfig } from '@/lib/tier-config';
import type { DisplayMode, ThumbnailSize, TierListMode } from '@/lib/tier-config';

interface TierListBoardProps {
  shareId?: string;
}

export function TierListBoard({ shareId }: TierListBoardProps) {
  const locale = useLocale();
  const s = tierListStrings[locale];

  const {
    mode,
    tierDefs,
    tiers,
    pool,
    vnMap,
    importedUser,
    hydrated,
    vnCount,
    setMode,
    handleDrop,
    addVN,
    addVNToTier,
    movePoolItemToTier,
    updateVN,
    removeVN,
    moveToPool,
    importFromVNDB,
    setImportedUser,
    listTitle,
    setListTitle,
    isVNInList,
    removeTier,
    renameTier,
    recolorTier,
    clearTier,
    moveTier,
    insertTier,
    applyPreset,
    clearAll,
    isAtCapacity,
    loadFromShare,
    shareLoading,
    shareError,
    storageWarning,
    dismissStorageWarning,
    saveStatus,
  } = useTierListState(shareId);

  // Display mode (lazy init from localStorage — no effect needed)
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => {
    if (typeof window === 'undefined') return 'covers';
    const stored = localStorage.getItem('tierlist-display-mode');
    return stored === 'covers' || stored === 'titles' ? stored : 'covers';
  });
  const toggleDisplayMode = useCallback(() => {
    setDisplayMode(prev => {
      const next = prev === 'covers' ? 'titles' : 'covers';
      localStorage.setItem('tierlist-display-mode', next);
      return next;
    });
  }, []);

  // Thumbnail size
  const [thumbnailSize, setThumbnailSize] = useState<ThumbnailSize>(() => {
    if (typeof window === 'undefined') return 'md';
    const stored = localStorage.getItem('tierlist-thumbnail-size');
    return stored === 'sm' || stored === 'md' || stored === 'lg' ? stored : 'md';
  });

  // Cover aspect ratio
  const [cropSquare, setCropSquare] = useState(() => {
    try { return localStorage.getItem('tierlist-crop-square') === 'true'; }
    catch { return false; }
  });
  const sizeConfig = getSizeConfig(thumbnailSize, cropSquare);

  // Title / score overlays
  const [showTitles, setShowTitles] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const [titleMaxH, setTitleMaxH] = useState(40);

  // Direct-add: skip pool, add to last tier
  const [directAdd, setDirectAdd] = useState(() => {
    try { return localStorage.getItem('tierlist-direct-add') === 'true'; }
    catch { return false; }
  });

  // Settings dropdown
  const { preference, setPreference } = useTitlePreference();
  const nsfwContext = useNSFWRevealContext();
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

  // Edit modal
  const [editingVnId, setEditingVnId] = useState<string | null>(null);

  // Add-to-tier modal
  const [addToTierId, setAddToTierId] = useState<string | null>(null);

  const handleEditSave = useCallback((data: { customTitle?: string; vote?: number; imageUrl?: string; imageSexual?: number }) => {
    if (editingVnId) updateVN(editingVnId, data);
    setEditingVnId(null);
  }, [editingVnId, updateVN]);

  const handleModeSwitch = useCallback((newMode: TierListMode) => {
    if (newMode === mode) return;
    if (vnCount > 0 && !window.confirm(s['confirm.modeSwitch'])) return;
    setMode(newMode);
  }, [mode, vnCount, setMode, s]);

  // Drop settle micro-interaction — applied via DOM to avoid re-rendering all rows
  const dropTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyDropFlash = useCallback((itemId: string) => {
    if (dropTimeoutRef.current) clearTimeout(dropTimeoutRef.current);
    // Wait one frame for React to commit the DOM update, then find and animate
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`);
      if (el) {
        el.classList.add('tier-just-dropped');
        dropTimeoutRef.current = setTimeout(() => el.classList.remove('tier-just-dropped'), 300);
      }
    });
  }, []);

  // Custom zero-re-render drag system
  const boardRef = useRef<HTMLDivElement>(null);
  const onDrop = useCallback((itemId: string, containerId: string, insertIndex: number) => {
    handleDrop(itemId, containerId, insertIndex);
    applyDropFlash(itemId);
  }, [handleDrop, applyDropFlash]);
  useTierDrag(boardRef, { onDrop });

  // Wrap moveToPool to apply drop flash for the pool item
  const handleMoveToPool = useCallback((vnId: string) => {
    moveToPool(vnId);
    applyDropFlash(vnId);
  }, [moveToPool, applyDropFlash]);

  // VNDB import state
  const [showImport, setShowImport] = useState(false);
  const [importInput, setImportInput] = useState('');
  const [importToPool, setImportToPool] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importProgress, setImportProgress] = useState('');

  // Shared import logic
  const runImport = useCallback(async (username: string, toPool = false) => {
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

      importFromVNDB(scored, toPool);
      setImportedUser(username);
      return true;
    } catch (err) {
      setImportError(err instanceof Error ? err.message : s['import.failed']);
      return false;
    } finally {
      setImporting(false);
      setImportProgress('');
    }
  }, [importFromVNDB, setImportedUser, s]);

  // Auto-load from share link
  const shareLoadedRef = useRef(false);
  useEffect(() => {
    if (!shareId || shareLoadedRef.current) return;
    shareLoadedRef.current = true;
    loadFromShare(shareId).then(settings => {
      if (!settings) return;
      if (settings.displayMode === 'covers' || settings.displayMode === 'titles') setDisplayMode(settings.displayMode);
      if (settings.thumbnailSize === 'sm' || settings.thumbnailSize === 'md' || settings.thumbnailSize === 'lg') setThumbnailSize(settings.thumbnailSize);
      if (typeof settings.showTitles === 'boolean') setShowTitles(settings.showTitles);
      if (typeof settings.showScores === 'boolean') setShowScores(settings.showScores);
      if (typeof settings.titleMaxH === 'number') setTitleMaxH(settings.titleMaxH);
      if (typeof settings.cropSquare === 'boolean') setCropSquare(settings.cropSquare);
      if (settings.titlePreference) setPreference(settings.titlePreference);
    });
  }, [shareId, loadFromShare]);

  const handleImport = async (e: FormEvent) => {
    e.preventDefault();
    const value = importInput.trim();
    if (!value) return;

    const ok = await runImport(value, importToPool);
    if (ok) {
      setShowImport(false);
      setImportInput('');
    }
  };

  const handleAddVN = useCallback((vn: Parameters<typeof addVN>[0]) => {
    addVN(vn, directAdd);
  }, [addVN, directAdd]);

  const handleFillModalSelect = useCallback((vn: Parameters<typeof addVNToTier>[0]) => {
    if (!addToTierId) return;
    addVNToTier(vn, addToTierId);
  }, [addVNToTier, addToTierId]);

  const handleFillModalPoolSelect = useCallback((vnId: string) => {
    if (!addToTierId) return;
    movePoolItemToTier(vnId, addToTierId);
  }, [movePoolItemToTier, addToTierId]);

  return (
    <div>
      {/* Share loading banner */}
      {shareLoading && (
        <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Loading shared tier list&hellip;
        </div>
      )}
      {shareError && (
        <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {shareError}
        </div>
      )}

      {/* Search */}
      <div className="mb-2">
        <TierSearchAdd mode={mode} onAdd={handleAddVN} isItemInList={isVNInList} isAtCapacity={isAtCapacity} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-center gap-2 flex-wrap mb-3">
        {/* Content: Mode toggle */}
        <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <button
            onClick={() => handleModeSwitch('vns')}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1 ${
              mode === 'vns'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={s['toolbar.vnMode']}
          >
            <Monitor className="w-3.5 h-3.5" />
            {s['toolbar.vns']}
          </button>
          <button
            onClick={() => handleModeSwitch('characters')}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1 ${
              mode === 'characters'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={s['toolbar.charMode']}
          >
            <Users className="w-3.5 h-3.5" />
            {s['toolbar.characters']}
          </button>
        </div>

        {/* Tiers: Preset selector */}
        <div className="relative inline-flex items-center">
          <select
            value={getCurrentPresetId(tierDefs) ?? ''}
            onChange={e => {
              const preset = getPresetById(e.target.value);
              if (preset) applyPreset(preset);
            }}
            className="appearance-none pl-2.5 pr-7 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          >
            {TIER_PRESETS.map(preset => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-1.5 w-3 h-3 text-gray-400 pointer-events-none" />
        </div>
        {/* Display: Covers/Text + Size */}
        <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <button
            onClick={displayMode === 'covers' ? undefined : toggleDisplayMode}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1 ${
              displayMode === 'covers'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={s['toolbar.coverImages']}
          >
            <ImageIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={displayMode === 'titles' ? undefined : toggleDisplayMode}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1 ${
              displayMode === 'titles'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={s['toolbar.titleNames']}
          >
            <AlignJustify className="w-3.5 h-3.5" />
          </button>
        </div>
        {displayMode === 'covers' && (<>
          <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {(['sm', 'md', 'lg'] as const).map(size => (
              <button
                key={size}
                onClick={() => {
                  setThumbnailSize(size);
                  localStorage.setItem('tierlist-thumbnail-size', size);
                }}
                className={`px-2 py-1.5 text-xs font-medium transition-colors ${
                  thumbnailSize === size
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                title={size === 'sm' ? s['toolbar.smallThumbnails'] : size === 'md' ? s['toolbar.mediumThumbnails'] : s['toolbar.largeThumbnails']}
              >
                {size.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              onClick={() => { setCropSquare(false); localStorage.setItem('tierlist-crop-square', 'false'); }}
              className={`px-2 py-1.5 text-xs font-medium transition-colors ${
                !cropSquare
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title={s['toolbar.coverAspect']}
            >
              <RectangleVertical className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { setCropSquare(true); localStorage.setItem('tierlist-crop-square', 'true'); }}
              className={`px-2 py-1.5 text-xs font-medium transition-colors ${
                cropSquare
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title={s['toolbar.squareCrop']}
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          </div>
        </>)}
        <div ref={settingsRef} className="relative">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className={`p-1.5 rounded-lg transition-colors ${
              settingsOpen
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                : 'text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-300'
            }`}
            title={s['controls.displaySettings']}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          {settingsOpen && (
            <div
              className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1 z-50 w-52 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl p-3 space-y-2"
            >
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={showScores} onChange={e => setShowScores(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                {s['controls.scores']}
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={nsfwContext?.allRevealed ?? false} onChange={e => nsfwContext?.setAllRevealed(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                {s['controls.nsfw']}
              </label>
              {displayMode === 'covers' && (
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                  <input type="checkbox" checked={showTitles} onChange={e => setShowTitles(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                  {s['controls.titles']}
                </label>
              )}
              <div className="border-t border-gray-100 dark:border-gray-700" />
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={directAdd} onChange={e => { setDirectAdd(e.target.checked); localStorage.setItem('tierlist-direct-add', String(e.target.checked)); }} className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                {s['controls.directAdd']}
              </label>
              <div className="border-t border-gray-100 dark:border-gray-700" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600 dark:text-gray-300">{s['controls.language']}</span>
                <div className="inline-flex items-center rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <button
                    onClick={() => setPreference('romaji')}
                    className={`px-2 py-1 text-xs font-medium transition-colors ${
                      preference === 'romaji'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    EN
                  </button>
                  <button
                    onClick={() => setPreference('japanese')}
                    className={`px-2 py-1 text-xs font-medium transition-colors ${
                      preference === 'japanese'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    JP
                  </button>
                </div>
              </div>
              <div className="border-t border-gray-100 dark:border-gray-700" />
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <span className="whitespace-nowrap">{s['controls.titleHeight']}</span>
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
                  className="w-12 px-1 py-0.5 text-xs text-center rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
            {s['toolbar.import']}
          </button>
        )}
        <button
          onClick={() => {
            clearAll();
            const base = `/${locale === 'en' ? '' : locale + '/'}tierlist/`;
            if (window.location.pathname !== base || window.location.search) {
              history.replaceState(null, '', base);
            }
          }}
          disabled={vnCount === 0}
          className="inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={s['toolbar.clear']}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{s['toolbar.clear']}</span>
        </button>

        <div className="hidden sm:block h-6 w-px bg-gray-200 dark:bg-gray-700" />

        {/* Export: Share + Copy + Export */}
        <TierListControls
          mode={mode}
          tierDefs={tierDefs}
          tiers={tiers}
          pool={pool}
          vnMap={vnMap}
          username={importedUser ?? ''}
          displayMode={displayMode}
          thumbnailSize={thumbnailSize}
          sizeConfig={sizeConfig}
          vnCount={vnCount}
          importing={importing}
          showTitles={showTitles}
          showScores={showScores}
          titleMaxH={titleMaxH}
          listTitle={listTitle}
          cropSquare={cropSquare}
        />
      </div>


      {/* VNDB import form */}
      {mode === 'vns' && showImport && (
        <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
          <form onSubmit={handleImport} className="flex gap-2">
            <input
              type="text"
              value={importInput}
              onChange={e => setImportInput(e.target.value)}
              placeholder={s['import.placeholder']}
              disabled={importing}
              className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={importing || !importInput.trim()}
              className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : s['import.button']}
            </button>
          </form>
          <div className="mt-2 flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
              <input
                type="radio"
                name="import-dest"
                checked={!importToPool}
                onChange={() => setImportToPool(false)}
                className="text-blue-600 focus:ring-blue-500"
              />
              {s['import.autoSort']}
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
              <input
                type="radio"
                name="import-dest"
                checked={importToPool}
                onChange={() => setImportToPool(true)}
                className="text-blue-600 focus:ring-blue-500"
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

      {/* Title header — always visible, editable inline */}
      <div className="py-2.5">
        <input
          type="text"
          value={listTitle}
          onChange={e => setListTitle(e.target.value)}
          placeholder={s['controls.titlePlaceholder']}
          maxLength={60}
          className="w-full text-base font-bold text-center bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 outline-none"
        />
      </div>

      {/* Tier list board */}
      <VnMapProvider value={vnMap}>
        <div ref={boardRef}>
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900">
            {tierDefs.map((tier, index) => (
              <TierRow
                key={tier.id}
                tier={tier}
                vnIds={tiers[tier.id] ?? EMPTY_STRING_ARRAY}
                tierIndex={index}
                mode={mode}
                displayMode={displayMode}
                sizeConfig={sizeConfig}
                showTitles={showTitles}
                showScores={showScores}
                titleMaxH={titleMaxH}
                canDelete={tierDefs.length > 1}
                nsfwRevealed={nsfwContext?.allRevealed ?? false}
                onRemoveVN={handleMoveToPool}
                onEditVN={setEditingVnId}
                onRenameTier={renameTier}
                onRecolorTier={recolorTier}
                onDeleteTier={removeTier}
                onClearTier={clearTier}
                onMoveTier={moveTier}
                onInsertTier={insertTier}
                onAddToTier={setAddToTierId}
                isFirst={index === 0}
                isLast={index === tierDefs.length - 1}
              />
            ))}
          </div>

          <TierPool
            pool={pool}
            mode={mode}
            displayMode={displayMode}
            sizeConfig={sizeConfig}
            showTitles={showTitles}
            showScores={showScores}
            titleMaxH={titleMaxH}
            onRemoveVN={removeVN}
            onEditVN={setEditingVnId}
          />
        </div>
      </VnMapProvider>

      <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
        {vnCount !== 1
          ? s[mode === 'characters' ? 'controls.charCountPlural' : 'controls.vnCountPlural'].replace('{count}', String(vnCount))
          : s[mode === 'characters' ? 'controls.charCount' : 'controls.vnCount'].replace('{count}', String(vnCount))}
      </p>
      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 text-center">
        {s[mode === 'characters' ? 'hint.textChars' : 'hint.text']}
      </p>
      {saveStatus && (
        <p className="mt-1 text-center text-[10px] text-gray-300 dark:text-gray-600">
          {saveStatus.type === 'saved'
            ? `Last autosaved: ${new Date(saveStatus.time).toLocaleTimeString()}`
            : 'Draft cleared'}
        </p>
      )}

      <div className="mt-6 flex justify-center">
        <Link
          href={locale === 'en' ? '/3x3-maker/' : '/ja/3x3-maker/'}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
        >
          <Grid3X3 className="w-4 h-4" />
          {s['hint.try3x3']}
        </Link>
      </div>

      {/* Add-to-tier modal */}
      {addToTierId && tierDefs.find(t => t.id === addToTierId) && (
        <TierRowFillModal
          tier={tierDefs.find(t => t.id === addToTierId)!}
          mode={mode}
          pool={pool}
          vnMap={vnMap}
          isVNInList={isVNInList}
          onSelect={handleFillModalSelect}
          onSelectFromPool={handleFillModalPoolSelect}
          onClose={() => setAddToTierId(null)}
        />
      )}

      {/* Edit modal */}
      {editingVnId && vnMap[editingVnId] && (
        <VNEditModal
          vn={vnMap[editingVnId]}
          onSave={handleEditSave}
          onCancel={() => setEditingVnId(null)}
        />
      )}

      {storageWarning && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md px-4 py-3 rounded-lg bg-amber-100 dark:bg-amber-900/80 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-sm shadow-lg flex items-center gap-2">
          <span className="flex-1">{s['storage.warning']}</span>
          <button onClick={dismissStorageWarning} className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 font-medium shrink-0">OK</button>
        </div>
      )}
    </div>
  );
}
