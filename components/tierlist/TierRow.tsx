'use client';

import { memo, useCallback, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { TierItem } from './TierItem';
import { TierEditPopover } from './TierEditPopover';
import { useVnMap } from './VnMapContext';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';
import type { TierDef, TierColor, DisplayMode, SizeConfig, TierListMode } from '@/lib/tier-config';

interface TierRowProps {
  tier: TierDef;
  vnIds: string[];
  tierIndex: number;
  mode: TierListMode;
  displayMode: DisplayMode;
  sizeConfig: SizeConfig;
  showTitles: boolean;
  showScores: boolean;
  titleMaxH: number;
  canDelete: boolean;
  justDroppedId: string | null;
  onRemoveVN: (vnId: string) => void;
  onEditVN: (vnId: string) => void;
  onRenameTier: (tierId: string, label: string) => void;
  onRecolorTier: (tierId: string, color: TierColor) => void;
  onDeleteTier: (tierId: string) => void;
  onClearTier: (tierId: string) => void;
  onMoveTier: (tierId: string, direction: 'up' | 'down') => void;
  onInsertTier: (tierId: string, position: 'above' | 'below') => void;
  isFirst: boolean;
  isLast: boolean;
}

export const TierRow = memo(function TierRow({
  tier, vnIds, tierIndex, mode, displayMode, sizeConfig, showTitles, showScores, titleMaxH, canDelete, justDroppedId,
  onRemoveVN, onEditVN, onRenameTier, onRecolorTier, onDeleteTier, onClearTier, onMoveTier, onInsertTier, isFirst, isLast,
}: TierRowProps) {
  const vnMap = useVnMap();
  const locale = useLocale();
  const s = tierListStrings[locale];
  const { setNodeRef, isOver } = useDroppable({ id: tier.id });

  const handleRename = useCallback((label: string) => onRenameTier(tier.id, label), [tier.id, onRenameTier]);
  const handleRecolor = useCallback((color: TierColor) => onRecolorTier(tier.id, color), [tier.id, onRecolorTier]);
  const handleDelete = useCallback(() => onDeleteTier(tier.id), [tier.id, onDeleteTier]);
  const handleClear = useCallback(() => onClearTier(tier.id), [tier.id, onClearTier]);
  const handleMoveUp = useCallback(() => onMoveTier(tier.id, 'up'), [tier.id, onMoveTier]);
  const handleMoveDown = useCallback(() => onMoveTier(tier.id, 'down'), [tier.id, onMoveTier]);
  const handleInsertAbove = useCallback(() => onInsertTier(tier.id, 'above'), [tier.id, onInsertTier]);
  const handleInsertBelow = useCallback(() => onInsertTier(tier.id, 'below'), [tier.id, onInsertTier]);
  const [popoverOpen, setPopoverOpen] = useState(false);

  return (
    <div className={`tier-row${isOver ? ' tier-row-active' : ''} flex border-b border-gray-200 dark:border-gray-700 last:border-b-0${popoverOpen ? ' relative z-40' : ''}`} style={{ contain: 'layout style' }}>
      {/* Tier label — click to edit */}
      <TierEditPopover
        tier={tier}
        itemCount={vnIds.length}
        onRename={handleRename}
        onRecolor={handleRecolor}
        onDelete={handleDelete}
        onClear={handleClear}
        onMoveUp={handleMoveUp}
        onMoveDown={handleMoveDown}
        onInsertAbove={handleInsertAbove}
        onInsertBelow={handleInsertBelow}
        canDelete={canDelete}
        isFirst={isFirst}
        isLast={isLast}
        onOpenChange={setPopoverOpen}
      />

      {/* Drop zone */}
      <SortableContext items={vnIds}>
        <div
          ref={setNodeRef}
          className={`flex flex-wrap ${sizeConfig.rowGap} ${sizeConfig.rowPad} flex-1 ${sizeConfig.rowMinH} transition-all duration-200 ${
            isOver ? 'bg-blue-50/60 dark:bg-blue-900/15 shadow-[inset_0_0_0_2px_rgba(59,130,246,0.15)]' : ''
          }${isFirst ? ' rounded-tr-lg' : ''}${isLast ? ' rounded-br-lg' : ''}`}
        >
          {vnIds.map(id => (
            <TierItem key={id} id={id} vn={vnMap[id]} tierIndex={tierIndex} displayMode={displayMode} sizeConfig={sizeConfig} showTitles={showTitles} showScores={showScores} titleMaxH={titleMaxH} onRemove={onRemoveVN} onEdit={onEditVN} justDropped={justDroppedId === id} />
          ))}
          {vnIds.length === 0 && (
            <div className={`flex items-center justify-center w-full -ml-6 sm:-ml-8 text-xs text-gray-400 dark:text-gray-500 select-none ${isOver ? 'animate-pulse' : ''}`}>
              {s[mode === 'characters' ? 'tier.dragHereChars' : 'tier.dragHere']}
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
});
