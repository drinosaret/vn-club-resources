'use client';

import React, { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import Link from '@/components/Link';
import { Upload, Trash2, Loader2, Image as ImageIcon, AlignJustify, Grid3X3, Dices, Monitor, Users, Settings, ChevronDown, Square, RectangleVertical } from 'lucide-react';
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

  // Display mode
  const [displayMode, setDisplayMode] = useState<DisplayMode>('covers');
  const toggleDisplayMode = useCallback(() => {
    setDisplayMode(prev => {
      const next = prev === 'covers' ? 'titles' : 'covers';
      localStorage.setItem('tierlist-display-mode', next);
      return next;
    });
  }, []);

  // Thumbnail size
  const [thumbnailSize, setThumbnailSize] = useState<ThumbnailSize>('md');

  // Cover aspect ratio
  const [cropSquare, setCropSquare] = useState(false);
  const sizeConfig = getSizeConfig(thumbnailSize, cropSquare);

  // Title / score overlays
  const [showTitles, setShowTitles] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const [titleMaxH, setTitleMaxH] = useState(40);

  // Direct-add: skip pool, add to last tier
  const [directAdd, setDirectAdd] = useState(false);

  // The toolbar is server-rendered from the defaults above, and display mode decides which of its
  // groups exist at all, so stored settings are applied after mount rather than in the initialisers.
  useEffect(() => {
    try {
      const storedDisplay = localStorage.getItem('tierlist-display-mode');
      if (storedDisplay === 'covers' || storedDisplay === 'titles') setDisplayMode(storedDisplay);
      const storedSize = localStorage.getItem('tierlist-thumbnail-size');
      if (storedSize === 'sm' || storedSize === 'md' || storedSize === 'lg') setThumbnailSize(storedSize);
      setCropSquare(localStorage.getItem('tierlist-crop-square') === 'true');
      setDirectAdd(localStorage.getItem('tierlist-direct-add') === 'true');
    } catch { /* storage unavailable: keep the defaults */ }
  }, []);

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

  // Drop settle micro-interaction: applied via DOM to avoid re-rendering all rows
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
      // The payload also records the language its author read in, which is deliberately not
      // applied: the title language is a site-wide setting the visitor owns, and the export and
      // any onward share read it back from there rather than from this board.
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

  const currentPresetId = getCurrentPresetId(tierDefs);

  return (
    <div>
      {/* Share loading banner */}
      {shareLoading && (
        <div className="toy-panel mb-3 flex items-center gap-2 p-3 text-sm text-[color:var(--nezu)]">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          {s['share.loading']}
        </div>
      )}
      {shareError && (
        <div className="bw-alert mb-3 p-3 text-sm">
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
        <div className="rc-seg">
          <button
            onClick={() => handleModeSwitch('vns')}
            className={`rc-seg-item gap-1 ${mode === 'vns' ? 'rc-seg-item--on' : ''}`}
            title={s['toolbar.vnMode']}
          >
            <Monitor className="w-3.5 h-3.5" />
            {s['toolbar.vns']}
          </button>
          <button
            onClick={() => handleModeSwitch('characters')}
            className={`rc-seg-item gap-1 ${mode === 'characters' ? 'rc-seg-item--on' : ''}`}
            title={s['toolbar.charMode']}
          >
            <Users className="w-3.5 h-3.5" />
            {s['toolbar.characters']}
          </button>
        </div>

        {/* Tiers: Preset selector */}
        <div className="relative inline-flex items-center">
          <select
            value={currentPresetId ?? ''}
            onChange={e => {
              const preset = getPresetById(e.target.value);
              if (preset) applyPreset(preset);
            }}
            className="st-select appearance-none pl-2.5 pr-7 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            {/* Once the rows have been edited the board matches no preset. An option carrying
                the empty value is needed for that state: without one the control falls back to
                showing the first preset as selected, which then cannot be chosen again. */}
            {currentPresetId === null && <option value="" disabled>{s['toolbar.customPreset']}</option>}
            {TIER_PRESETS.map(preset => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-1.5 w-3 h-3 text-[color:var(--nezu)] pointer-events-none" />
        </div>
        {/* Display: Covers/Text + Size */}
        <div className="rc-seg">
          <button
            onClick={displayMode === 'covers' ? undefined : toggleDisplayMode}
            className={`rc-seg-item rc-seg-item--icon ${displayMode === 'covers' ? 'rc-seg-item--on' : ''}`}
            title={s['toolbar.coverImages']}
          >
            <ImageIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={displayMode === 'titles' ? undefined : toggleDisplayMode}
            className={`rc-seg-item rc-seg-item--icon ${displayMode === 'titles' ? 'rc-seg-item--on' : ''}`}
            title={s['toolbar.titleNames']}
          >
            <AlignJustify className="w-3.5 h-3.5" />
          </button>
        </div>
        {displayMode === 'covers' && (<>
          <div className="rc-seg">
            {(['sm', 'md', 'lg'] as const).map(size => (
              <button
                key={size}
                onClick={() => {
                  setThumbnailSize(size);
                  localStorage.setItem('tierlist-thumbnail-size', size);
                }}
                className={`rc-seg-item ${thumbnailSize === size ? 'rc-seg-item--on' : ''}`}
                title={size === 'sm' ? s['toolbar.smallThumbnails'] : size === 'md' ? s['toolbar.mediumThumbnails'] : s['toolbar.largeThumbnails']}
              >
                {size.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="rc-seg">
            <button
              onClick={() => { setCropSquare(false); localStorage.setItem('tierlist-crop-square', 'false'); }}
              className={`rc-seg-item rc-seg-item--icon ${!cropSquare ? 'rc-seg-item--on' : ''}`}
              title={s['toolbar.coverAspect']}
            >
              <RectangleVertical className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { setCropSquare(true); localStorage.setItem('tierlist-crop-square', 'true'); }}
              className={`rc-seg-item rc-seg-item--icon ${cropSquare ? 'rc-seg-item--on' : ''}`}
              title={s['toolbar.squareCrop']}
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          </div>
        </>)}
        <div ref={settingsRef} className="relative">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className={`toy-btn ${settingsOpen ? 'toy-btn--on' : ''}`}
            title={s['controls.displaySettings']}
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{s['controls.displaySettings']}</span>
          </button>
          {settingsOpen && (
            <div className="toy-menu absolute right-0 top-full mt-1 z-50 w-52 p-3 space-y-2">
              <label className="toy-check-row">
                <input type="checkbox" checked={showScores} onChange={e => setShowScores(e.target.checked)} className="bw-check" />
                {s['controls.scores']}
              </label>
              <label className="toy-check-row">
                <input type="checkbox" checked={nsfwContext?.allRevealed ?? false} onChange={e => nsfwContext?.setAllRevealed(e.target.checked)} className="bw-check" />
                {s['controls.nsfw']}
              </label>
              {displayMode === 'covers' && (
                <label className="toy-check-row">
                  <input type="checkbox" checked={showTitles} onChange={e => setShowTitles(e.target.checked)} className="bw-check" />
                  {s['controls.titles']}
                </label>
              )}
              <div className="border-t border-[color:var(--rule)]" />
              <label className="toy-check-row">
                <input type="checkbox" checked={directAdd} onChange={e => { setDirectAdd(e.target.checked); localStorage.setItem('tierlist-direct-add', String(e.target.checked)); }} className="bw-check" />
                {s['controls.directAdd']}
              </label>
              <div className="border-t border-[color:var(--rule)]" />
              <div className="flex items-center justify-between gap-2">
                <span className="toy-label">{s['controls.language']}</span>
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
                <span className="toy-label whitespace-nowrap">{s['controls.titleHeight']}</span>
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
            clearAll();
            const base = `/${locale === 'en' ? '' : locale + '/'}tierlist/`;
            if (window.location.pathname !== base || window.location.search) {
              history.replaceState(null, '', base);
            }
          }}
          disabled={vnCount === 0}
          className="toy-btn toy-btn--drop"
          title={s['toolbar.clear']}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{s['toolbar.clear']}</span>
        </button>

        <div className="toy-divider hidden sm:block" />

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
                name="import-dest"
                checked={!importToPool}
                onChange={() => setImportToPool(false)}
                className="bw-check"
              />
              {s['import.autoSort']}
            </label>
            <label className="toy-check-row">
              <input
                type="radio"
                name="import-dest"
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

      {/* Title header: always visible, editable inline */}
      <div className="py-2.5">
        <input
          type="text"
          value={listTitle}
          onChange={e => setListTitle(e.target.value)}
          placeholder={s['controls.titlePlaceholder']}
          maxLength={60}
          className="toy-title-field"
        />
      </div>

      {/* Tier list board */}
      <VnMapProvider value={vnMap}>
        <div ref={boardRef}>
          <div className="toy-panel">
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

      <p className="mt-2 text-center font-mono text-xs tabular-nums text-[color:var(--nezu)]">
        {vnCount !== 1
          ? s[mode === 'characters' ? 'controls.charCountPlural' : 'controls.vnCountPlural'].replace('{count}', String(vnCount))
          : s[mode === 'characters' ? 'controls.charCount' : 'controls.vnCount'].replace('{count}', String(vnCount))}
      </p>
      <p className="mt-1 text-center text-xs text-[color:var(--text-faint)]">
        {s[mode === 'characters' ? 'hint.textChars' : 'hint.text']}
      </p>
      {saveStatus && (
        <p className="mt-1 text-center font-mono text-[10px] text-[color:var(--text-faint)]">
          {saveStatus.type === 'saved'
            ? t(s, 'status.lastSaved', {
                time: new Date(saveStatus.time).toLocaleTimeString(locale === 'ja' ? 'ja-JP' : undefined),
              })
            : s['status.draftCleared']}
        </p>
      )}

      <div className="mt-6 flex justify-center gap-4">
        <Link
          href={locale === 'en' ? '/3x3-maker/' : '/ja/3x3-maker/'}
          className="toy-btn"
        >
          <Grid3X3 className="w-4 h-4" />
          {s['hint.try3x3']}
        </Link>
        <Link
          href={locale === 'en' ? '/roulette/' : '/ja/roulette/'}
          className="toy-btn"
        >
          <Dices className="w-4 h-4" />
          {s['hint.tryRoulette']}
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
        <div className="toy-toast">
          <span className="flex-1">{s['storage.warning']}</span>
          <button onClick={dismissStorageWarning} className="toy-btn shrink-0">OK</button>
        </div>
      )}
    </div>
  );
}
