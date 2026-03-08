'use client';

import { NSFWImage } from '@/components/NSFWImage';
import type { GridItem } from '@/hooks/useGridMakerState';

interface GridDragOverlayProps {
  item: GridItem | undefined;
  cropSquare?: boolean;
  previewUrl?: string | null;
}

export function GridDragOverlay({ item, cropSquare, previewUrl }: GridDragOverlayProps) {
  const src = previewUrl ?? item?.imageUrl;
  return (
    <div className={`${cropSquare ? 'w-[100px] h-[100px]' : 'w-[100px] h-[150px]'} rounded-sm overflow-hidden shadow-xl ring-2 ring-purple-500 rotate-2 opacity-90`}>
      {src ? (
        <NSFWImage
          src={src}
          alt=""
          vnId={item?.id ?? ''}
          imageSexual={item?.imageSexual ?? null}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-[9px] text-gray-600 dark:text-gray-300 p-1 text-center">
          {item?.title}
        </div>
      )}
    </div>
  );
}
