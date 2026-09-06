'use client';

import { getTinySrc } from '@/lib/vndb-image-cache';
import { NSFW_THRESHOLD } from '@/lib/nsfw-reveal';
import type { GridItem } from '@/hooks/useGridMakerState';

interface GridDragOverlayProps {
  item: GridItem | undefined;
  cropSquare?: boolean;
  previewUrl?: string | null;
  cellWidth?: number;
  nsfwRevealed?: boolean;
}

export function GridDragOverlay({ item, cropSquare, previewUrl, cellWidth, nsfwRevealed }: GridDragOverlayProps) {
  const src = previewUrl ?? item?.imageUrl;
  const isNsfw = !nsfwRevealed && (item?.imageSexual ?? 0) >= NSFW_THRESHOLD;
  const w = cellWidth ?? 100;
  const h = cropSquare ? w : Math.round(w * 1.5);
  return (
    <div
      className="rounded-xs overflow-hidden outline-2 outline-[color:var(--kohaku)] rotate-2 opacity-90"
      style={{ width: w, height: h }}
    >
      {src ? (
        isNsfw ? (
          <img
            src={getTinySrc(src)}
            alt=""
            className="w-full h-full object-cover"
            style={{ imageRendering: 'pixelated' }}
            decoding="async"
          />
        ) : (
          <img
            src={src}
            alt=""
            className="w-full h-full object-cover"
            decoding="async"
          />
        )
      ) : (
        <div className="w-full h-full bg-[color:var(--surface-inset)] flex items-center justify-center text-[9px] text-[color:var(--nezu)] p-1 text-center">
          {item?.title}
        </div>
      )}
    </div>
  );
}
