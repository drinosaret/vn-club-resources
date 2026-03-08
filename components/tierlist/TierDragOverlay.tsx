'use client';

import { NSFWImage } from '@/components/NSFWImage';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import type { TierVN, DisplayMode, SizeConfig } from '@/lib/tier-config';

interface TierDragOverlayProps {
  vn: TierVN | undefined;
  displayMode: DisplayMode;
  sizeConfig: SizeConfig;
}

export function TierDragOverlay({ vn, displayMode, sizeConfig }: TierDragOverlayProps) {
  const { preference } = useTitlePreference();

  const title = vn?.customTitle
    || (vn && (vn.titleJp || vn.titleRomaji)
      ? getDisplayTitle({ title: vn.title, title_jp: vn.titleJp, title_romaji: vn.titleRomaji }, preference)
      : vn?.title ?? '');

  if (displayMode === 'titles') {
    return (
      <div className="px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 shadow-2xl ring-1 ring-blue-400/50 scale-105 opacity-90 tier-drag-overlay">
        <span className="text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
          {title}
        </span>
      </div>
    );
  }

  return (
    <div className={`${sizeConfig.overlayClass} rounded overflow-hidden shadow-2xl ring-1 ring-blue-400/50 rotate-[1.5deg] scale-105 opacity-95 tier-drag-overlay`}>
      {vn?.imageUrl ? (
        <NSFWImage
          src={vn.imageUrl}
          alt=""
          vnId={vn.id}
          imageSexual={vn.imageSexual}
          className="w-full h-full object-cover object-top"
        />
      ) : (
        <div className="w-full h-full bg-gray-300 dark:bg-gray-600" />
      )}
    </div>
  );
}
