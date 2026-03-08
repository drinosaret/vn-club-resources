'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Eraser, ChevronUp, ChevronDown, Plus } from 'lucide-react';
import { TIER_COLORS } from '@/lib/tier-config';
import type { TierDef, TierColor } from '@/lib/tier-config';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';

interface TierEditPopoverProps {
  tier: TierDef;
  itemCount: number;
  onRename: (label: string) => void;
  onRecolor: (color: TierColor) => void;
  onDelete: () => void;
  onClear: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  canDelete: boolean;
  isFirst: boolean;
  isLast: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function TierEditPopover({ tier, itemCount, onRename, onRecolor, onDelete, onClear, onMoveUp, onMoveDown, onInsertAbove, onInsertBelow, canDelete, isFirst, isLast, onOpenChange }: TierEditPopoverProps) {
  const locale = useLocale();
  const s = tierListStrings[locale];
  const [isOpen, _setIsOpen] = useState(false);
  const setIsOpen = (open: boolean) => { _setIsOpen(open); onOpenChange?.(open); };
  const [editLabel, setEditLabel] = useState(tier.label);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  // Sync editLabel when tier.label changes externally
  useEffect(() => {
    setEditLabel(tier.label);
  }, [tier.label]);

  // Close on click outside + Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapperRef.current && !wrapperRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  // Compute fixed position when opening
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPopoverPos({ top: rect.top, left: rect.right + 4 });
    }
    if (!isOpen) setPopoverPos(null);
  }, [isOpen]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.select(), 50);
  }, [isOpen]);

  const handleLabelSubmit = () => {
    const trimmed = editLabel.trim();
    if (trimmed && trimmed !== tier.label) {
      onRename(trimmed);
    } else {
      setEditLabel(tier.label);
    }
  };

  return (
    <div ref={wrapperRef} className="shrink-0">
      {/* Tier label button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-12 sm:w-16 h-full flex items-center justify-center font-bold cursor-pointer hover:opacity-80 transition-opacity ${tier.color} ${tier.textColor} ${
          tier.label.length > 3 ? 'text-[10px] sm:text-xs leading-tight' : 'text-lg sm:text-xl'
        }${isFirst ? ' rounded-tl-lg' : ''}${isLast ? ' rounded-bl-lg' : ''}`}
        title={s['tierEdit.editTier']}
      >
        {tier.label}
      </button>

      {/* Popover — fixed position via portal */}
      {isOpen && popoverPos && createPortal(
        <div ref={popoverRef} style={{ position: 'fixed', top: popoverPos.top, left: popoverPos.left }} className="z-50 w-48 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl p-3 space-y-3">
          {/* Rename */}
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{s['tierEdit.label']}</label>
            <input
              ref={inputRef}
              type="text"
              value={editLabel}
              onChange={e => setEditLabel(e.target.value.slice(0, 10))}
              onBlur={handleLabelSubmit}
              onKeyDown={e => { if (e.key === 'Enter') handleLabelSubmit(); }}
              maxLength={10}
              className="w-full px-2 py-1 text-sm rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Color picker */}
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{s['tierEdit.color']}</label>
            <div className="grid grid-cols-6 gap-1.5">
              {TIER_COLORS.map(tc => (
                <button
                  key={tc.id}
                  onClick={() => { onRecolor(tc); }}
                  className={`w-6 h-6 rounded ${tc.color} ${
                    tier.color === tc.color ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-800' : ''
                  } hover:scale-110 transition-transform`}
                  title={tc.id}
                />
              ))}
            </div>
          </div>

          {/* Row actions */}
          <div className="space-y-0.5">
            <button
              onClick={() => { onClear(); setIsOpen(false); }}
              disabled={itemCount === 0}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Eraser className="w-3.5 h-3.5" />
              {s['tierEdit.clearRow']}
            </button>
            <button
              onClick={() => { onMoveUp(); }}
              disabled={isFirst}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronUp className="w-3.5 h-3.5" />
              {s['tierEdit.moveUp']}
            </button>
            <button
              onClick={() => { onMoveDown(); }}
              disabled={isLast}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              {s['tierEdit.moveDown']}
            </button>
            <button
              onClick={() => { onInsertAbove(); setIsOpen(false); }}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {s['tierEdit.addAbove']}
            </button>
            <button
              onClick={() => { onInsertBelow(); setIsOpen(false); }}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {s['tierEdit.addBelow']}
            </button>
          </div>

          {/* Delete */}
          {canDelete && (
            <button
              onClick={() => { onDelete(); setIsOpen(false); }}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {s['tierEdit.deleteTier']}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
