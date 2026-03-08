'use client';

import { memo, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X, Plus, Pencil } from 'lucide-react';
import { NSFWImage } from '@/components/NSFWImage';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import type { GridItem } from '@/hooks/useGridMakerState';
import { useLocale } from '@/lib/i18n/locale-context';
import { gridMakerStrings } from '@/lib/i18n/translations/grid-maker';

interface GridCellProps {
  id: string;
  index: number;
  item: GridItem | null;
  cropSquare: boolean;
  showTitles: boolean;
  showScores: boolean;
  titleMaxH: number;
  isDropTarget?: boolean;
  isTargeted?: boolean;
  onCellClick: () => void;
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
  id, index, item, cropSquare, showTitles, showScores, titleMaxH, isDropTarget, isTargeted, onCellClick, onRemove, onCropEdit, cropPreviewMap,
}: GridCellProps) {
  const { preference } = useTitlePreference();
  const locale = useLocale();
  const s = gridMakerStrings[locale];
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
  if (cropPreviewMap && item?.id) {
    if (previewUrl) cropPreviewMap.current[item.id] = previewUrl;
    else delete cropPreviewMap.current[item.id];
  }

  const style = useMemo(() => ({
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0 : 1,
    contain: 'style paint' as const,
  }), [transform, isDragging]);

  // Image loading state for shimmer placeholder
  // Must be declared before the early return to satisfy Rules of Hooks
  // When crop data exists but canvas preview isn't ready yet, apply crop via CSS
  // so the uncropped original is never visible.
  // Use object-position to center on the crop region — not pixel-perfect but eliminates flash.
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
  const [imageLoaded, setImageLoaded] = useState(false);
  const prevDisplaySrc = useRef(displaySrc);
  if (displaySrc !== prevDisplaySrc.current) {
    prevDisplaySrc.current = displaySrc;
    // Only reset when going from an image to no image.
    // When swapping cells (src→src), keep imageLoaded true — the browser has
    // the image cached and will display it immediately. Resetting causes a
    // visible flash in Firefox where the cache probe fails for proxy URLs.
    if (!displaySrc && imageLoaded) setImageLoaded(false);
  }
  const handleImageLoad = useCallback(() => setImageLoaded(true), []);

  if (!item) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`${cropSquare ? 'aspect-square' : 'aspect-[2/3]'} bg-gray-100 dark:bg-gray-800 border-2 border-dashed ${isTargeted ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' : isDropTarget ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' : 'border-gray-300 dark:border-gray-600'} rounded-sm flex items-center justify-center cursor-pointer hover:border-purple-400 dark:hover:border-purple-500 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group/empty`}
        onClick={onCellClick}
        {...attributes}
      >
        <Plus className={`w-6 h-6 transition-colors ${isTargeted ? 'text-purple-500' : 'text-gray-400 dark:text-gray-500 group-hover/empty:text-purple-500'}`} />
      </div>
    );
  }

  // Resolve title: custom override > language preference > stored title
  const displayTitle = item.customTitle
    || ((item.titleJp || item.titleRomaji)
      ? getDisplayTitle({ title: item.title, title_jp: item.titleJp, title_romaji: item.titleRomaji }, preference)
      : item.title);

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, touchAction: 'manipulation' }}
      {...attributes}
      {...listeners}
      className={`${cropSquare ? 'aspect-square' : 'aspect-[2/3]'} rounded-sm overflow-hidden cursor-grab active:cursor-grabbing touch-manipulation select-none group/cell bg-gray-200 dark:bg-gray-700 relative ${isDropTarget ? 'ring-2 ring-purple-500' : ''}`}
      title={displayTitle}
    >
      {displaySrc ? (
        <>
          <NSFWImage
            src={displaySrc}
            alt={displayTitle}
            vnId={item.id}
            imageSexual={item.imageSexual}
            className={`w-full h-full object-cover ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            style={cssCropImgStyle}
            loading={index < 9 ? 'eager' : 'lazy'}
            overlaySrc={!hasPendingCrop ? tinyPreviewUrl ?? undefined : undefined}
            onLoad={handleImageLoad}
          />
          {!imageLoaded && <div className="absolute inset-0 image-placeholder" />}
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-500 dark:text-gray-400 text-center p-1 leading-tight">
          {displayTitle}
        </div>
      )}

      {/* Title overlay */}
      {!isDragging && showTitles && displayTitle && displaySrc && (() => {
        const maxLines = Math.max(1, Math.floor(titleMaxH / (cropSquare ? 14 : 10)));
        return (
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 pointer-events-none">
            <p
              className="text-[10px] sm:text-xs font-bold text-white text-center leading-tight"
              style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: maxLines, overflow: 'hidden' }}
            >
              {displayTitle}
            </p>
          </div>
        );
      })()}

      {/* Score badge */}
      {!isDragging && showScores && item.vote && (
        <div className="absolute top-1 left-1 bg-black/70 text-white text-[10px] sm:text-xs font-bold px-1.5 py-0.5 rounded-full pointer-events-none min-w-[24px] text-center z-10">
          {item.vote}
        </div>
      )}

      {/* Edit button */}
      {!isDragging && <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onCropEdit(); }}
        className="touch-action-btn absolute top-7 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity z-10 hover:bg-black/80"
        title={s['cell.edit']}
        aria-label={s['cell.edit']}
      >
        <Pencil className="w-3 h-3" />
      </button>}

      {/* Remove button */}
      {!isDragging && <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onRemove(); }}
        className="touch-action-btn absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity z-10 hover:bg-red-600"
        title={s['cell.remove']}
        aria-label={s['cell.remove']}
      >
        <X className="w-3 h-3" />
      </button>}
    </div>
  );
});
