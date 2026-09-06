'use client';

import { memo, useMemo } from 'react';
import { X, Pencil } from 'lucide-react';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';
import { getTinySrc } from '@/lib/vndb-image-cache';
import { NSFW_THRESHOLD } from '@/lib/nsfw-reveal';
import type { TierVN, DisplayMode, SizeConfig } from '@/lib/tier-config';

interface TierPoolItemProps {
  id: string;
  vn: TierVN | undefined;
  displayMode: DisplayMode;
  sizeConfig: SizeConfig;
  showTitles: boolean;
  showScores: boolean;
  titleMaxH: number;
  nsfwRevealed: boolean;
  onRemove: (vnId: string) => void;
  onEdit: (vnId: string) => void;
}

const ITEM_STYLE: React.CSSProperties = { contain: 'style paint' };

// Lightweight pool-only version of TierItem: plain <img> instead of NSFWImage, no dnd-kit hooks
export const TierPoolItem = memo(function TierPoolItem({ id, vn, displayMode, sizeConfig, showTitles, showScores, titleMaxH, nsfwRevealed, onRemove, onEdit }: TierPoolItemProps) {
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

  const isNsfw = !nsfwRevealed && (vn?.imageSexual ?? 0) >= NSFW_THRESHOLD;

  const srcSet = useMemo(() => {
    if (!vn?.imageUrl || isNsfw) return undefined;
    // A stored cover URL can already carry a width, and both the route and the cache in front
    // of it read the first w= in the query, so an appended one would never take effect.
    const base = vn.imageUrl.replace(/([?&])w=\d+(&|$)/, '$1').replace(/[?&]$/, '');
    const sep = base.includes('?') ? '&' : '?';
    return [128, 256].map(w => `${base}${sep}w=${w} ${w}w`).join(', ');
  }, [vn?.imageUrl, isNsfw]);

  if (displayMode === 'titles') {
    return (
      <div
        data-item-id={id}
        style={ITEM_STYLE}
        className="toy-tag cursor-grab active:cursor-grabbing select-none group/tier-item"
        title={title}
      >
        <span className="truncate">
          {title}
          {showScores && vn?.vote && (
            <span className="ml-1 font-mono text-[10px] tabular-nums text-[color:var(--nezu)]">{vn.vote}</span>
          )}
        </span>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onEdit(id); }}
          className="toy-act toy-act--inline touch-action-btn shrink-0 w-3.5 h-3.5 toy-act--reveal"
          title={s['tierItem.edit']}
          aria-label={s['tierItem.edit']}
        >
          <Pencil className="w-2 h-2" />
        </button>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onRemove(id); }}
          className="toy-act toy-act--drop toy-act--inline touch-action-btn shrink-0 w-3.5 h-3.5 toy-act--reveal"
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
      className={`toy-tile ${sizeConfig.coverClass} shrink-0 cursor-grab active:cursor-grabbing select-none group/tier-item`}
      title={title}
    >
      {vn?.imageUrl ? (
        isNsfw ? (
          <img
            src={getTinySrc(vn.imageUrl)}
            alt={title}
            className="w-full h-full object-cover object-top"
            style={{ imageRendering: 'pixelated' }}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <img
            src={vn.imageUrl}
            srcSet={srcSet}
            sizes={sizeConfig.coverSizes}
            alt={title}
            className="w-full h-full object-cover object-top"
            loading="lazy"
            decoding="async"
          />
        )
      ) : (
        <div className={`w-full h-full flex items-center justify-center ${sizeConfig.noImageFontClass} text-[color:var(--nezu)] text-center p-0.5 leading-tight`}>
          {title.slice(0, 20)}
        </div>
      )}

      {/* Score badge */}
      {showScores && vn?.vote && (
        <div className={`toy-mark top-0.5 left-0.5 ${sizeConfig.scoreFontClass} px-1 py-px ${sizeConfig.scoreMinW}`}>
          {vn.vote}
        </div>
      )}

      {/* Title overlay */}
      {showTitles && title && (() => {
        const maxLines = Math.max(1, Math.floor(titleMaxH / 10));
        return (
          <div className="toy-cap">
            <p
              className={sizeConfig.titleFontClass}
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
        className={`toy-act touch-action-btn ${sizeConfig.editBtnTopClass} right-0.5 ${sizeConfig.actionBtnClass} toy-act--reveal`}
        title={s['tierItem.edit']}
        aria-label={s['tierItem.edit']}
      >
        <Pencil className={sizeConfig.actionIconClass} />
      </button>

      {/* Remove button */}
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onRemove(id); }}
        className={`toy-act toy-act--drop touch-action-btn top-0.5 right-0.5 ${sizeConfig.actionBtnClass} toy-act--reveal`}
        title={s['tierItem.remove']}
        aria-label={s['tierItem.remove']}
      >
        <X className={sizeConfig.actionIconClass} />
      </button>
    </div>
  );
});
