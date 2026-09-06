'use client';

import { memo, useState, useEffect, useRef, useCallback } from 'react';
// Progressive rendering removed; the 3x3 pool renders all items directly and has no Firefox flash bug
import { Pin, PinOff, ChevronUp, ChevronDown, LayoutGrid } from 'lucide-react';
import { TierPoolItem } from './TierPoolItem';
import { useVnMap } from './VnMapContext';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';
import { useNSFWRevealContext } from '@/lib/nsfw-reveal';
import type { TierListMode, DisplayMode, SizeConfig } from '@/lib/tier-config';

const PINNED_KEY = 'tierlist-pool-pinned';

interface TierPoolProps {
  pool: string[];
  mode: TierListMode;
  displayMode: DisplayMode;
  sizeConfig: SizeConfig;
  showTitles: boolean;
  showScores: boolean;
  titleMaxH: number;
  onRemoveVN: (vnId: string) => void;
  onEditVN: (vnId: string) => void;
}

export const TierPool = memo(function TierPool({
  pool, mode, displayMode, sizeConfig, showTitles, showScores, titleMaxH,
  onRemoveVN, onEditVN,
}: TierPoolProps) {
  const vnMap = useVnMap();
  const locale = useLocale();
  const s = tierListStrings[locale];
  const nsfwContext = useNSFWRevealContext();
  const nsfwRevealed = nsfwContext?.allRevealed ?? false;
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<HTMLDivElement>(null);

  // Load pinned state from localStorage + auto-collapse on touch devices
  useEffect(() => {
    let wasPinned = false;
    try {
      wasPinned = localStorage.getItem(PINNED_KEY) === 'true';
    } catch { /* ignore */ }
    if (wasPinned) {
      // The header toggle and its chevron are absent while pinned, so a docked pool that
      // started collapsed would have no way back and nothing to drop items on.
      setPinned(true);
      return;
    }
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
      setCollapsed(true);
    }
  }, []);

  const togglePinned = useCallback(() => {
    setPinned(prev => {
      const next = !prev;
      try { localStorage.setItem(PINNED_KEY, String(next)); } catch { /* ignore */ }
      if (next) setCollapsed(false);
      return next;
    });
  }, []);

  // When pinned, set the placeholder height to match the pool element
  useEffect(() => {
    if (!pinned || !poolRef.current || !placeholderRef.current) return;
    const update = () => {
      if (poolRef.current && placeholderRef.current) {
        placeholderRef.current.style.height = `${poolRef.current.offsetHeight}px`;
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(poolRef.current);
    return () => observer.disconnect();
  }, [pinned, collapsed]);

  const poolContent = (
    <div
      ref={poolRef}
      className={`toy-panel relative isolate overflow-hidden ${pinned ? 'toy-panel--dock' : ''}`}
    >
      {/* Pool header */}
      <div className="toy-panel-head select-none">
        <button
          onClick={() => !pinned && setCollapsed(prev => !prev)}
          aria-expanded={!collapsed}
          className="toy-cmd flex-1"
        >
          <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
          <span>{s['pool.label']}</span>
          {pool.length > 0 && <span className="toy-count">{pool.length}</span>}
          {!pinned && (
            <span className="ml-auto">
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </span>
          )}
        </button>
        {/* Pin toggle */}
        <button
          onClick={togglePinned}
          className={`toy-x mr-1 ${pinned ? 'toy-x--on' : ''}`}
          title={pinned ? s['pool.unpin'] : s['pool.pin']}
        >
          {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Pool content - overflow managed by useTierDrag during drag */}
      {!collapsed && (
        <div
          data-tier-drop="pool"
          className={`tier-pool-scroll flex flex-wrap justify-center ${sizeConfig.rowGap} ${sizeConfig.rowPad} min-h-[3rem] max-h-[30vh] sm:max-h-[240px] overflow-x-hidden overflow-y-auto`}
          style={{ scrollbarGutter: 'stable' }}
        >
          {pool.map(id => (
            <TierPoolItem
              key={id}
              id={id}
              vn={vnMap[id]}
              displayMode={displayMode}
              sizeConfig={sizeConfig}
              showTitles={showTitles}
              showScores={showScores}
              titleMaxH={titleMaxH}
              nsfwRevealed={nsfwRevealed}
              onRemove={onRemoveVN}
              onEdit={onEditVN}
            />
          ))}
          {pool.length === 0 && (
            <div className="toy-slot w-full select-none py-3 text-xs">
              {s[mode === 'characters' ? 'pool.emptyHintChars' : 'pool.emptyHint']}
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (pinned) {
    return (
      <>
        {/* Spacer to prevent content from hiding behind the fixed pool */}
        <div ref={placeholderRef} className="mt-3" />
        {/* Fixed pool at bottom */}
        <div className="fixed bottom-0 left-0 right-0 z-40 px-2 pb-2 sm:px-4 sm:pb-3 pointer-events-none">
          <div className="max-w-5xl mx-auto pointer-events-auto">
            {poolContent}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="mt-3">
      {poolContent}
    </div>
  );
});
