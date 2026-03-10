'use client';

import { memo, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { TierItem } from './TierItem';
import { TierEditPopover } from './TierEditPopover';
import { useVnMap } from './VnMapContext';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';
import { t } from '@/lib/i18n/types';
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
  onRemoveVN: (vnId: string) => void;
  onEditVN: (vnId: string) => void;
  onRenameTier: (tierId: string, label: string) => void;
  onRecolorTier: (tierId: string, color: TierColor) => void;
  onDeleteTier: (tierId: string) => void;
  onClearTier: (tierId: string) => void;
  onMoveTier: (tierId: string, direction: 'up' | 'down') => void;
  onInsertTier: (tierId: string, position: 'above' | 'below') => void;
  nsfwRevealed: boolean;
  onAddToTier: (tierId: string) => void;
  isFirst: boolean;
  isLast: boolean;
}

export const TierRow = memo(function TierRow({
  tier, vnIds, tierIndex, mode, displayMode, sizeConfig, showTitles, showScores, titleMaxH, canDelete, nsfwRevealed,
  onRemoveVN, onEditVN, onRenameTier, onRecolorTier, onDeleteTier, onClearTier, onMoveTier, onInsertTier, onAddToTier, isFirst, isLast,
}: TierRowProps) {
  const vnMap = useVnMap();
  const locale = useLocale();
  const s = tierListStrings[locale];

  const handleRename = useCallback((label: string) => onRenameTier(tier.id, label), [tier.id, onRenameTier]);
  const handleRecolor = useCallback((color: TierColor) => onRecolorTier(tier.id, color), [tier.id, onRecolorTier]);
  const handleDelete = useCallback(() => onDeleteTier(tier.id), [tier.id, onDeleteTier]);
  const handleClear = useCallback(() => onClearTier(tier.id), [tier.id, onClearTier]);
  const handleMoveUp = useCallback(() => onMoveTier(tier.id, 'up'), [tier.id, onMoveTier]);
  const handleMoveDown = useCallback(() => onMoveTier(tier.id, 'down'), [tier.id, onMoveTier]);
  const handleInsertAbove = useCallback(() => onInsertTier(tier.id, 'above'), [tier.id, onInsertTier]);
  const handleInsertBelow = useCallback(() => onInsertTier(tier.id, 'below'), [tier.id, onInsertTier]);
  const handleAddToTier = useCallback(() => onAddToTier(tier.id), [tier.id, onAddToTier]);

  return (
    <div className="tier-row flex border-b border-gray-200 dark:border-gray-700 last:border-b-0" style={{ contain: 'style' }}>
      {/* Tier label — click to edit */}
      <TierEditPopover
        tier={tier}
        tierIndex={tierIndex}
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
      />

      {/* Drop zone */}
      <div
        data-tier-drop={tier.id}
        className={`flex flex-wrap ${sizeConfig.rowGap} ${sizeConfig.rowPad} flex-1 min-w-0 ${sizeConfig.rowMinH} transition-colors duration-200${isFirst ? ' rounded-tr-lg' : ''}${isLast ? ' rounded-br-lg' : ''}`}
      >
        {vnIds.map(id => (
          <TierItem key={id} id={id} vn={vnMap[id]} tierIndex={tierIndex} displayMode={displayMode} sizeConfig={sizeConfig} showTitles={showTitles} showScores={showScores} titleMaxH={titleMaxH} nsfwRevealed={nsfwRevealed} onRemove={onRemoveVN} onEdit={onEditVN} />
        ))}
        {/* Add-to-tier button */}
        {displayMode === 'covers' ? (
          <button
            onClick={handleAddToTier}
            className={`${sizeConfig.coverClass} border-2 border-dashed border-gray-200 dark:border-gray-700 rounded hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors flex items-center justify-center group shrink-0`}
            title={t(s, 'tier.addToTier', { tier: tier.label })}
          >
            <Plus className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-blue-400 dark:group-hover:text-blue-500 transition-colors" />
          </button>
        ) : (
          <button
            onClick={handleAddToTier}
            className="self-stretch w-10 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors flex items-center justify-center group shrink-0"
            title={t(s, 'tier.addToTier', { tier: tier.label })}
          >
            <Plus className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-blue-400 dark:group-hover:text-blue-500 transition-colors" />
          </button>
        )}
        {vnIds.length === 0 && (
          <div className="flex items-center justify-center flex-1 -ml-6 sm:-ml-8 text-xs text-gray-400 dark:text-gray-500 select-none pointer-events-none">
            {s[mode === 'characters' ? 'tier.dragHereChars' : 'tier.dragHere']}
          </div>
        )}
      </div>
    </div>
  );
});
