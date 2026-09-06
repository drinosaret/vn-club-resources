'use client';

import { memo, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X, Plus, Pencil, Eye } from 'lucide-react';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { getTinySrc } from '@/lib/vndb-image-cache';
import { NSFW_THRESHOLD, useNSFWRevealContext } from '@/lib/nsfw-reveal';
import type { GridItem } from '@/hooks/useGridMakerState';
import { useLocale } from '@/lib/i18n/locale-context';
import { gridMakerStrings } from '@/lib/i18n/translations/grid-maker';
import { t } from '@/lib/i18n/types';

interface GridCellProps {
  id: string;
  index: number;
  gridSize: number;
  item: GridItem | null;
  cropSquare: boolean;
  showTitles: boolean;
  showScores: boolean;
  titleMaxH: number;
  isDropTarget?: boolean;
  isTargeted?: boolean;
  onCellClick: () => void;
  nsfwRevealed: boolean;
  onRemove: () => void;
  onCropEdit: () => void;
  cropPreviewMap?: React.MutableRefObject<Record<string, string>>;
}

function generateCropPreview(
  imageUrl: string,
  croppedArea: { x: number; y: number; width: number; height: number },
): Promise<{ preview: string; tiny: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const sx = (croppedArea.x / 100) * img.naturalWidth;
      const sy = (croppedArea.y / 100) * img.naturalHeight;
      const sw = (croppedArea.width / 100) * img.naturalWidth;
      const sh = (croppedArea.height / 100) * img.naturalHeight;

      // Target ~400px on the longest side
      const cropAspect = sw / sh;
      const tw = cropAspect >= 1 ? 400 : Math.round(400 * cropAspect);
      const th = cropAspect >= 1 ? Math.round(400 / cropAspect) : 400;

      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);

      // Also generate a tiny version for NSFW pixelation overlay
      const tinyCanvas = document.createElement('canvas');
      tinyCanvas.width = 20;
      tinyCanvas.height = Math.round(20 / cropAspect);
      const tctx = tinyCanvas.getContext('2d')!;
      tctx.drawImage(img, sx, sy, sw, sh, 0, 0, tinyCanvas.width, tinyCanvas.height);

      let previewUrl = '';
      canvas.toBlob(
        blob => {
          if (!blob) { reject(new Error('toBlob failed')); return; }
          previewUrl = URL.createObjectURL(blob);
          tinyCanvas.toBlob(
            tinyBlob => {
              if (!tinyBlob) { resolve({ preview: previewUrl, tiny: previewUrl }); return; }
              resolve({ preview: previewUrl, tiny: URL.createObjectURL(tinyBlob) });
            },
            'image/webp',
            0.5,
          );
        },
        'image/webp',
        0.9,
      );
    };
    img.onerror = () => reject(new Error('Image load failed'));
    // Use smaller source on mobile for faster preview generation
    const previewW = typeof window !== 'undefined' && window.innerWidth < 640 ? 256 : 512;
    img.src = imageUrl.replace(/w=\d+/, `w=${previewW}`);
  });
}

export const GridCell = memo(function GridCell({
  id, index, gridSize, item, cropSquare, showTitles, showScores, titleMaxH, isDropTarget, isTargeted, nsfwRevealed, onCellClick, onRemove, onCropEdit, cropPreviewMap,
}: GridCellProps) {
  const { preference } = useTitlePreference();
  const locale = useLocale();
  const s = gridMakerStrings[locale];
  const nsfwContext = useNSFWRevealContext();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({
    id,
    disabled: !item,
  });

  // Crop preview: prefer the pre-generated blob URL on the item (set by CropModal).
  // Fallback: generate async for share-link loads where blob URLs don't survive.
  const [fallbackPreview, setFallbackPreview] = useState<string | null>(null);
  const [fallbackTiny, setFallbackTiny] = useState<string | null>(null);
  const fallbackRef = useRef<string | null>(null);
  const fallbackTinyRef = useRef<string | null>(null);

  const cropKey = item?.cropData
    ? `${item.cropData.croppedArea.x}-${item.cropData.croppedArea.y}-${item.cropData.croppedArea.width}-${item.cropData.croppedArea.height}`
    : '';

  const needsFallback = !!item?.cropData && !item.cropPreview;

  useEffect(() => {
    if (fallbackRef.current) { URL.revokeObjectURL(fallbackRef.current); fallbackRef.current = null; }
    if (fallbackTinyRef.current) { URL.revokeObjectURL(fallbackTinyRef.current); fallbackTinyRef.current = null; }

    if (!needsFallback || !item?.imageUrl || !item?.cropData) {
      setFallbackPreview(null);
      setFallbackTiny(null);
      return;
    }

    let cancelled = false;
    generateCropPreview(item.imageUrl!, item.cropData!.croppedArea)
      .then(({ preview, tiny }) => {
        if (cancelled) { URL.revokeObjectURL(preview); URL.revokeObjectURL(tiny); return; }
        fallbackRef.current = preview;
        fallbackTinyRef.current = tiny;
        setFallbackPreview(preview);
        setFallbackTiny(tiny);
      })
      .catch(() => {
        if (!cancelled) { setFallbackPreview(null); setFallbackTiny(null); }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsFallback, item?.imageUrl, cropKey]);

  useEffect(() => {
    return () => {
      if (fallbackRef.current) URL.revokeObjectURL(fallbackRef.current);
      if (fallbackTinyRef.current) URL.revokeObjectURL(fallbackTinyRef.current);
    };
  }, []);

  const previewUrl = item?.cropPreview ?? fallbackPreview;
  const tinyPreviewUrl = item?.cropPreviewTiny ?? fallbackTiny;

  // Keep cropPreviewMap in sync for DragOverlay
  useEffect(() => {
    if (cropPreviewMap && item?.id) {
      if (previewUrl) cropPreviewMap.current[item.id] = previewUrl;
      else delete cropPreviewMap.current[item.id];
    }
  }, [cropPreviewMap, item?.id, previewUrl]);

  const style = useMemo(() => ({
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0 : 1,
    transition: isDragging ? undefined : 'opacity 150ms ease',
    contain: 'style paint' as const,
  }), [transform, isDragging]);

  // Image loading state for shimmer placeholder
  // Must be declared before the early return to satisfy Rules of Hooks
  // When crop data exists but canvas preview isn't ready yet, apply crop via CSS
  // so the uncropped original is never visible.
  // Use object-position to center on the crop region, not pixel-perfect but eliminates flash.
  const hasPendingCrop = !!item?.cropData && !previewUrl;
  const cssCropImgStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!hasPendingCrop || !item?.cropData) return undefined;
    const { x, y, width, height } = item.cropData.croppedArea;
    // Center of the crop region in percentage of the original image
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    return { objectPosition: `${centerX}% ${centerY}%` };
  }, [hasPendingCrop, item?.cropData]);
  const displaySrc = previewUrl ?? item?.imageUrl ?? null;
  const isRevealed = nsfwContext?.isRevealed(item?.id ?? '') ?? false;
  const isNsfw = !nsfwRevealed && !isRevealed && (item?.imageSexual ?? 0) >= NSFW_THRESHOLD;
  const [imageLoaded, setImageLoaded] = useState(false);
  const prevDisplaySrc = useRef(displaySrc);
  if (displaySrc !== prevDisplaySrc.current) {
    prevDisplaySrc.current = displaySrc;
    // Only reset when going from an image to no image.
    // When swapping cells (src→src), keep imageLoaded true: the browser has
    // the image cached and will display it immediately. Resetting causes a
    // visible flash in Firefox where the cache probe fails for proxy URLs.
    if (!displaySrc && imageLoaded) setImageLoaded(false);
  }
  const handleImageLoad = useCallback(() => setImageLoaded(true), []);

  // An empty cell is the board's main action, so it answers the keys a button answers.
  // Space is prevented to stop the page scrolling under the board.
  const handleEmptyKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onCellClick();
    }
  }, [onCellClick]);

  // Memoize title resolution (must be above early return for Rules of Hooks)
  const displayTitle = useMemo(() => {
    if (!item) return '';
    return item.customTitle
      || ((item.titleJp || item.titleRomaji)
        ? getDisplayTitle({ title: item.title, title_jp: item.titleJp, title_romaji: item.titleRomaji }, preference)
        : item.title);
  }, [item, preference]);

  if (!item) {
    // The sortable attributes are not spread here: an empty cell is never draggable, and they
    // would announce it as a disabled sortable rather than as the button it is. The droppable
    // ref stays, so a drag can still land on it.
    const emptyLabel = t(s, 'cell.empty', {
      n: index + 1,
      row: Math.floor(index / gridSize) + 1,
      col: (index % gridSize) + 1,
    });
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`toy-slot ${cropSquare ? 'aspect-square' : 'aspect-[2/3]'} cursor-pointer ${isTargeted || isDropTarget ? 'toy-slot--on' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={emptyLabel}
        onClick={onCellClick}
        onKeyDown={handleEmptyKeyDown}
      >
        <Plus className="w-6 h-6" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, touchAction: 'manipulation' }}
      {...attributes}
      {...listeners}
      className={`toy-tile ${cropSquare ? 'aspect-square' : 'aspect-[2/3]'} cursor-grab active:cursor-grabbing touch-manipulation select-none group/cell ${isDropTarget ? 'outline-2 outline-offset-[-2px] outline-[color:var(--kohaku)]' : ''}`}
      title={displayTitle}
    >
      {displaySrc ? (
        <>
          {isNsfw ? (
            <div className="w-full h-full cursor-pointer group/nsfw" onClick={e => { e.stopPropagation(); if (item?.id) nsfwContext?.revealVN(item.id); }}>
              <img
                src={tinyPreviewUrl ?? getTinySrc(displaySrc)}
                alt={displayTitle}
                className="w-full h-full object-cover"
                style={{ imageRendering: 'pixelated' }}
                loading="lazy"
                decoding="async"
              />
              <div className="toy-veil">
                <div className="flex flex-col items-center gap-1 px-2 text-center text-xs font-medium sm:text-[10px]">
                  <Eye className="w-5 h-5 sm:w-4 sm:h-4" />
                  <span className="sm:hidden">Tap to reveal</span>
                  <span className="hidden sm:inline">Click to reveal</span>
                </div>
              </div>
            </div>
          ) : (
            <img
              src={displaySrc}
              alt={displayTitle}
              className={`w-full h-full object-cover ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              style={cssCropImgStyle}
              loading={index < 9 ? 'eager' : 'lazy'}
              decoding="async"
              onLoad={handleImageLoad}
            />
          )}
          {!isNsfw && !imageLoaded && <div className="absolute inset-0 image-placeholder" />}
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-[color:var(--nezu)] text-center p-1 leading-tight">
          {displayTitle}
        </div>
      )}

      {/* Title overlay */}
      {!isDragging && showTitles && displayTitle && displaySrc && (() => {
        const maxLines = Math.max(1, Math.floor(titleMaxH / (cropSquare ? 14 : 10)));
        return (
          <div className="toy-cap">
            <p
              className="text-[10px] sm:text-xs"
              style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: maxLines, overflow: 'hidden' }}
            >
              {displayTitle}
            </p>
          </div>
        );
      })()}

      {/* Score badge */}
      {!isDragging && showScores && item.vote && (
        <div className="toy-mark top-1 left-1 text-[10px] sm:text-xs px-1.5 py-0.5 min-w-[24px]">
          {item.vote}
        </div>
      )}

      {/* Edit button */}
      {!isDragging && <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onCropEdit(); }}
        className="toy-act touch-action-btn top-7 right-1 w-5 h-5 toy-act--reveal"
        title={s['cell.edit']}
        aria-label={s['cell.edit']}
      >
        <Pencil className="w-3 h-3" />
      </button>}

      {/* Remove button */}
      {!isDragging && <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onRemove(); }}
        className="toy-act toy-act--drop touch-action-btn top-1 right-1 w-5 h-5 toy-act--reveal"
        title={s['cell.remove']}
        aria-label={s['cell.remove']}
      >
        <X className="w-3 h-3" />
      </button>}
    </div>
  );
});
