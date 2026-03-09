'use client';

import { memo, useState, useEffect, useRef, useCallback } from 'react';
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
  justDroppedId: string | null;
}

export const TierPool = memo(function TierPool({
  pool, mode, displayMode, sizeConfig, showTitles, showScores, titleMaxH,
  onRemoveVN, onEditVN, justDroppedId,
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

  // Progressive rendering: show first batch immediately, add more per frame
  const INITIAL_BATCH = 30;
  const BATCH_SIZE = 50;
  const [renderedCount, setRenderedCount] = useState(
    pool.length <= INITIAL_BATCH ? pool.length : INITIAL_BATCH
  );
  const prevPoolLenRef = useRef(pool.length);
  useEffect(() => {
    if (pool.length !== prevPoolLenRef.current) {
      prevPoolLenRef.current = pool.length;
      setRenderedCount(pool.length <= INITIAL_BATCH ? pool.length : INITIAL_BATCH);
    }
  }, [pool.length]);
  useEffect(() => {
    if (renderedCount >= pool.length) return;
    const id = requestAnimationFrame(() => {
      setRenderedCount(prev => Math.min(prev + BATCH_SIZE, pool.length));
    });
    return () => cancelAnimationFrame(id);
  }, [renderedCount, pool.length]);

  // Load pinned state from localStorage + auto-collapse on touch devices
  useEffect(() => {
    try {
      if (localStorage.getItem(PINNED_KEY) === 'true') setPinned(true);
    } catch { /* ignore */ }
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
      className={`border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900 ${
        pinned ? 'shadow-[0_-4px_20px_rgba(0,0,0,0.15)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.4)]' : ''
      }`}
    >
      {/* Pool header */}
      <div className="flex items-center bg-gray-100 dark:bg-gray-800 select-none">
        <button
          onClick={() => !pinned && setCollapsed(prev => !prev)}
          aria-expanded={!collapsed}
          className="flex-1 flex items-center gap-2 px-3 py-2 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <LayoutGrid className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 shrink-0" />
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            {s['pool.label']}
          </span>
          {pool.length > 0 && (
            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">
              {pool.length}
            </span>
          )}
          {!pinned && (
            <span className="ml-auto">
              {collapsed
                ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                : <ChevronUp className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
              }
            </span>
          )}
        </button>
        {/* Pin toggle */}
        <button
          onClick={togglePinned}
          className={`px-2.5 py-2 transition-colors ${
            pinned
              ? 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300'
              : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
          }`}
          title={pinned ? s['pool.unpin'] : s['pool.pin']}
        >
          {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Pool content - overflow managed by useTierDrag during drag */}
      {!collapsed && (
        <div
          data-tier-drop="pool"
          className={`tier-pool-scroll flex flex-wrap justify-center ${sizeConfig.rowGap} ${sizeConfig.rowPad} min-h-[3rem] max-h-[30vh] sm:max-h-[240px] overflow-y-auto transition-colors duration-200`}
          style={{ scrollbarGutter: 'stable' }}
        >
          {pool.slice(0, renderedCount).map(id => (
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
              justDropped={justDroppedId === id}
            />
          ))}
          {renderedCount < pool.length && (
            <div className="flex items-center justify-center w-full py-2">
              <div className="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin" />
            </div>
          )}
          {pool.length === 0 && (
            <div className="flex items-center justify-center w-full text-xs text-gray-400 dark:text-gray-500 select-none border border-dashed border-gray-300 dark:border-gray-600 rounded py-3">
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
