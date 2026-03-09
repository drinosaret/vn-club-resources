'use client';

import { memo, useMemo, useState, useCallback, useRef } from 'react';
import { X, Pencil } from 'lucide-react';
import { NSFWImage } from '@/components/NSFWImage';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';
import type { TierVN, DisplayMode, SizeConfig } from '@/lib/tier-config';

interface TierItemProps {
  id: string;
  vn: TierVN | undefined;
  tierIndex: number;
  displayMode: DisplayMode;
  sizeConfig: SizeConfig;
  showTitles: boolean;
  showScores: boolean;
  titleMaxH: number;
  onRemove: (vnId: string) => void;
  onEdit: (vnId: string) => void;
  justDropped?: boolean;
}

const ITEM_STYLE: React.CSSProperties = { contain: 'style paint' };

export const TierItem = memo(function TierItem({ id, vn, tierIndex, displayMode, sizeConfig, showTitles, showScores, titleMaxH, onRemove, onEdit, justDropped }: TierItemProps) {
  const { preference } = useTitlePreference();
  const locale = useLocale();
  const s = tierListStrings[locale];

  const title = useMemo(() => {
    const rawTitle = vn?.title ?? id;
    return vn?.customTitle
      || (vn && (vn.titleJp || vn.titleRomaji)
        ? getDisplayTitle({ title: vn.title, title_jp: vn.titleJp, title_romaji: vn.titleRomaji }, preference)
        : rawTitle);
  }, [id, vn, preference]);

  const srcSet = useMemo(() => {
    if (!vn?.imageUrl) return undefined;
    const sep = vn.imageUrl.includes('?') ? '&' : '?';
    return [128, 256].map(w => `${vn.imageUrl}${sep}w=${w} ${w}w`).join(', ');
  }, [vn?.imageUrl]);

  // Image loading state for shimmer placeholder
  const [imageLoaded, setImageLoaded] = useState(false);
  const prevImageUrl = useRef(vn?.imageUrl);
  if (vn?.imageUrl !== prevImageUrl.current) {
    prevImageUrl.current = vn?.imageUrl;
    if (!vn?.imageUrl && imageLoaded) setImageLoaded(false);
  }
  const handleImageLoad = useCallback(() => setImageLoaded(true), []);

  if (displayMode === 'titles') {
    return (
      <div
        data-item-id={id}
        style={ITEM_STYLE}
        className={`relative flex items-center gap-1 px-1.5 py-0.5 max-w-full rounded border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 cursor-grab active:cursor-grabbing select-none group/tier-item ${justDropped ? 'tier-just-dropped' : ''}`}
        title={title}
      >
        <span className="text-xs text-gray-700 dark:text-gray-300 truncate">
          {title}
          {showScores && vn?.vote && (
            <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500 font-medium">{vn.vote}</span>
          )}
        </span>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onEdit(id); }}
          className="touch-action-btn shrink-0 w-3.5 h-3.5 rounded-full bg-black/60 text-white items-center justify-center hidden group-hover/tier-item:flex hover:bg-black/80"
          title={s['tierItem.edit']}
          aria-label={s['tierItem.edit']}
        >
          <Pencil className="w-2 h-2" />
        </button>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onRemove(id); }}
          className="touch-action-btn shrink-0 w-3.5 h-3.5 rounded-full bg-red-500/80 text-white items-center justify-center hidden group-hover/tier-item:flex hover:bg-red-600"
          title={s['tierItem.remove']}
          aria-label={s['tierItem.remove']}
        >
          <X className="w-2 h-2" />
        </button>
      </div>
    );
  }

  return (
    <div
      data-item-id={id}
      style={ITEM_STYLE}
      className={`relative ${sizeConfig.coverClass} shrink-0 rounded overflow-hidden cursor-grab active:cursor-grabbing select-none group/tier-item bg-gray-200 dark:bg-gray-700 ${justDropped ? 'tier-just-dropped' : ''}`}
      title={title}
    >
      {vn?.imageUrl ? (
        <>
          <NSFWImage
            src={vn.imageUrl}
            srcSet={srcSet}
            sizes={sizeConfig.coverSizes}
            alt={title}
            vnId={id}
            imageSexual={vn.imageSexual}
            className={`w-full h-full object-cover object-top ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading={tierIndex === 0 ? 'eager' : 'lazy'}
            fetchPriority={tierIndex === 0 ? 'high' : undefined}
            onLoad={handleImageLoad}
          />
          {!imageLoaded && <div className="absolute inset-0 image-placeholder pointer-events-none" />}
        </>
      ) : (
        <div className={`w-full h-full flex items-center justify-center ${sizeConfig.noImageFontClass} text-gray-500 dark:text-gray-400 text-center p-0.5 leading-tight`}>
          {title.slice(0, 20)}
        </div>
      )}

      {/* Score badge */}
      {showScores && vn?.vote && (
        <div className={`absolute top-0.5 left-0.5 bg-black/70 text-white ${sizeConfig.scoreFontClass} font-bold px-1 py-px rounded-full pointer-events-none ${sizeConfig.scoreMinW} text-center leading-tight`}>
          {vn.vote}
        </div>
      )}

      {/* Title overlay */}
      {showTitles && title && (() => {
        const maxLines = Math.max(1, Math.floor(titleMaxH / 10));
        return (
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-0.5 py-0.5 pointer-events-none">
            <p
              className={`${sizeConfig.titleFontClass} font-bold text-white text-center leading-tight`}
              style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: maxLines, overflow: 'hidden' }}
            >
              {title}
            </p>
          </div>
        );
      })()}

      {/* Edit button */}
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onEdit(id); }}
        className={`touch-action-btn absolute ${sizeConfig.editBtnTopClass} right-0.5 ${sizeConfig.actionBtnClass} rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover/tier-item:opacity-100 transition-opacity z-10 hover:bg-black/80`}
        title={s['tierItem.edit']}
        aria-label={s['tierItem.edit']}
      >
        <Pencil className={sizeConfig.actionIconClass} />
      </button>

      {/* Remove button */}
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onRemove(id); }}
        className={`touch-action-btn absolute top-0.5 right-0.5 ${sizeConfig.actionBtnClass} rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/tier-item:opacity-100 transition-opacity z-10 hover:bg-red-600`}
        title={s['tierItem.remove']}
        aria-label={s['tierItem.remove']}
      >
        <X className={sizeConfig.actionIconClass} />
      </button>

    </div>
  );
});
