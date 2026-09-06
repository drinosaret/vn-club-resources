'use client';

import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Pin, PinOff, ChevronDown, ChevronUp, X, Pencil, LayoutGrid } from 'lucide-react';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { useNSFWRevealContext, NSFW_THRESHOLD } from '@/lib/nsfw-reveal';
import { useLocale } from '@/lib/i18n/locale-context';
import { gridMakerStrings } from '@/lib/i18n/translations/grid-maker';
import { getTinySrc } from '@/lib/vndb-image-cache';
import type { GridItem, GridMode } from '@/hooks/useGridMakerState';

const PINNED_KEY = 'grid-pool-pinned';

interface GridPoolProps {
  pool: string[];
  itemMap: Record<string, GridItem>;
  mode: GridMode;
  cropSquare: boolean;
  activeDrag: boolean;
  onRemove: (itemId: string) => void;
  onEdit: (itemId: string) => void;
}

// Lightweight draggable pool item, no SortableContext overhead
const PoolItem = memo(function PoolItem({
  itemId,
  item,
  cropSquare,
  nsfwRevealed,
  onRemove,
  onEdit,
}: {
  itemId: string;
  item: GridItem;
  cropSquare: boolean;
  nsfwRevealed: boolean;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const { preference } = useTitlePreference();
  const locale = useLocale();
  const s = gridMakerStrings[locale];

  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({ id: `pool-${itemId}` });

  const displayTitle = item.customTitle
    || ((item.titleJp || item.titleRomaji)
      ? getDisplayTitle({ title: item.title, title_jp: item.titleJp, title_romaji: item.titleRomaji }, preference)
      : item.title);

  const isNsfw = !nsfwRevealed && (item.imageSexual ?? 0) >= NSFW_THRESHOLD;

  return (
    <div
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0.4 : 1, contain: 'style paint', touchAction: 'manipulation' }}
      {...attributes}
      {...listeners}
      className={`toy-tile ${cropSquare ? 'w-[80px] h-[80px]' : 'w-[80px] h-[120px]'} cursor-grab active:cursor-grabbing touch-manipulation select-none group/pool-item shrink-0`}
      title={displayTitle}
    >
      {(item.cropPreview ?? item.imageUrl) ? (
        isNsfw ? (
          <img
            src={getTinySrc(item.cropPreview ?? item.imageUrl!)}
            alt={displayTitle}
            className="w-full h-full object-cover"
            style={{ imageRendering: 'pixelated' }}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <img
            src={item.cropPreview ?? item.imageUrl!}
            alt={displayTitle}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        )
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[9px] text-[color:var(--nezu)] text-center p-1 leading-tight">
          {displayTitle}
        </div>
      )}

      {/* Edit button */}
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onEdit(itemId); }}
        className="toy-act touch-action-btn top-[22px] right-0.5 w-4 h-4 toy-act--reveal"
        title={s['cell.edit']}
        aria-label={s['cell.edit']}
      >
        <Pencil className="w-2.5 h-2.5" />
      </button>

      {/* Remove button */}
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onRemove(itemId); }}
        className="toy-act toy-act--drop touch-action-btn top-0.5 right-0.5 w-4 h-4 toy-act--reveal"
        title={s['cell.remove']}
        aria-label={s['cell.remove']}
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </div>
  );
});

export const GridPool = memo(function GridPool({
  pool,
  itemMap,
  mode,
  cropSquare,
  activeDrag,
  onRemove,
  onEdit,
}: GridPoolProps) {
  const locale = useLocale();
  const s = gridMakerStrings[locale];
  const nsfwContext = useNSFWRevealContext();
  const nsfwRevealed = nsfwContext?.allRevealed ?? false;
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<HTMLDivElement>(null);

  const { setNodeRef, isOver } = useDroppable({ id: 'pool-drop' });
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef<number | null>(null);

  // Lock scroll position of the pool area during drag
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    if (activeDrag) {
      scrollLockRef.current = el.scrollTop;
      const lock = () => {
        if (scrollLockRef.current !== null) el.scrollTop = scrollLockRef.current;
      };
      el.addEventListener('scroll', lock);
      return () => el.removeEventListener('scroll', lock);
    }
    scrollLockRef.current = null;
  }, [activeDrag]);

  // Load pinned state from localStorage + auto-collapse on touch devices.
  // A pinned pool is never collapsed here: while pinned the header button does not toggle
  // and the drop area is not rendered, so the two states together leave no way to reopen it.
  useEffect(() => {
    let isPinned = false;
    try {
      isPinned = localStorage.getItem(PINNED_KEY) === 'true';
    } catch { /* ignore */ }
    if (isPinned) setPinned(true);
    if (!isPinned && typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
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
  }, [pinned, collapsed]); // pool.length not needed; ResizeObserver fires when children resize the element

  const poolContent = (
    <div
      ref={poolRef}
      className={`toy-panel overflow-hidden ${pinned ? 'toy-panel--dock' : ''}`}
    >
      {/* Header */}
      <div className="toy-panel-head select-none">
        <button
          onClick={() => !pinned && setCollapsed(!collapsed)}
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

      {/* Droppable pool area */}
      {!collapsed && (
        <div
          ref={(node) => { setNodeRef(node); scrollAreaRef.current = node; }}
          className={`flex flex-wrap justify-center gap-1.5 p-2 min-h-[3rem] max-h-[30vh] sm:max-h-[240px] overflow-y-auto ${
            isOver ? 'tier-drop-highlight' : ''
          }`}
          style={{ scrollbarGutter: 'stable' }}
        >
          {pool.map(itemId => {
            const item = itemMap[itemId];
            if (!item) return null;
            return (
              <PoolItem
                key={itemId}
                itemId={itemId}
                item={item}
                cropSquare={cropSquare}
                nsfwRevealed={nsfwRevealed}
                onRemove={onRemove}
                onEdit={onEdit}
              />
            );
          })}
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
        <div className="fixed bottom-0 left-0 right-0 z-40 px-2 pb-2 sm:px-4 sm:pb-3">
          <div className="max-w-4xl mx-auto">
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
