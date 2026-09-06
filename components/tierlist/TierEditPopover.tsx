'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Eraser, ChevronUp, ChevronDown, Plus } from 'lucide-react';
import { TIER_COLORS } from '@/lib/tier-config';
import type { TierDef, TierColor } from '@/lib/tier-config';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';

/** Distance kept from the tier label and from every viewport edge. */
const MENU_GAP = 4;

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
  tierIndex: number;
}

export function TierEditPopover({ tier, itemCount, onRename, onRecolor, onDelete, onClear, onMoveUp, onMoveDown, onInsertAbove, onInsertBelow, canDelete, isFirst, isLast, tierIndex }: TierEditPopoverProps) {
  const locale = useLocale();
  const s = tierListStrings[locale];
  const [isOpen, setIsOpen] = useState(false);
  const [editLabel, setEditLabel] = useState(tier.label);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  // Sync editLabel when tier.label changes externally
  useEffect(() => {
    setEditLabel(tier.label);
  }, [tier.label]);

  // Compute popover position: recalculate whenever the popover is open
  // useLayoutEffect prevents visible jump on reorder
  const updatePos = useCallback(() => {
    const trigger = buttonRef.current;
    const menu = popoverRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const view = document.documentElement;
    const height = menu.offsetHeight;
    const width = menu.offsetWidth;
    // Placed against the viewport rather than the page, and a scroll dismisses it, so a
    // position past an edge could never be brought back into view. It hangs beside the
    // label where there is room for it and on the label's other side otherwise.
    const top = Math.max(MENU_GAP, Math.min(rect.top, view.clientHeight - height - MENU_GAP));
    const left =
      rect.right + MENU_GAP + width <= view.clientWidth
        ? rect.right + MENU_GAP
        : Math.max(MENU_GAP, rect.left - MENU_GAP - width);
    setPopoverPos(prev => {
      if (prev && prev.top === top && prev.left === left) return prev;
      return { top, left };
    });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverPos(null);
      return;
    }
    updatePos();
  }, [isOpen, tierIndex, updatePos]);

  // Close on click outside, Escape, or scroll
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    const onScroll = (e: Event) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
    };
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
    <div className="shrink-0">
      {/* Tier label button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`toy-tierlabel w-12 sm:w-16 ${tier.color} ${tier.textColor} ${
          tier.label.length > 6 ? 'text-[8px] sm:text-[10px] leading-tight' : tier.label.length > 3 ? 'text-[10px] sm:text-xs leading-tight' : 'text-lg sm:text-xl'
        }`}
        title={s['tierEdit.editTier']}
      >
        {tier.label}
      </button>

      {/* Popover: portaled to body to avoid overflow clipping */}
      {isOpen && createPortal(
        <div
          ref={popoverRef}
          className="toy-menu fixed z-50 w-48 p-3 space-y-3"
          // A popover too tall for the viewport scrolls within itself, since scrolling the
          // page behind it dismisses it instead of revealing the rest. Held out of sight for
          // the frame it takes to measure, so it is never seen in the corner it is measured in.
          style={{
            maxHeight: `calc(100dvh - ${MENU_GAP * 2}px)`,
            overflowY: 'auto',
            ...(popoverPos
              ? { top: popoverPos.top, left: popoverPos.left }
              : { top: 0, left: 0, visibility: 'hidden' as const }),
          }}
        >
          {/* Rename */}
          <div>
            <label className="toy-label mb-1 block">{s['tierEdit.label']}</label>
            <input
              ref={inputRef}
              type="text"
              value={editLabel}
              onChange={e => setEditLabel(e.target.value.slice(0, 40))}
              onBlur={handleLabelSubmit}
              onKeyDown={e => { if (e.key === 'Enter') handleLabelSubmit(); }}
              maxLength={40}
              className="toy-field w-full"
            />
          </div>

          {/* Color picker */}
          <div>
            <label className="toy-label mb-1.5 block">{s['tierEdit.color']}</label>
            <div className="grid grid-cols-6 gap-1.5">
              {TIER_COLORS.map(tc => (
                <button
                  key={tc.id}
                  onClick={() => { onRecolor(tc); }}
                  className={`toy-swatch ${tc.color} ${tier.color === tc.color ? 'toy-swatch--on' : ''}`}
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
              className="toy-cmd"
            >
              <Eraser className="w-3.5 h-3.5" />
              {s['tierEdit.clearRow']}
            </button>
            <button
              onClick={() => { onMoveUp(); }}
              disabled={isFirst}
              className="toy-cmd"
            >
              <ChevronUp className="w-3.5 h-3.5" />
              {s['tierEdit.moveUp']}
            </button>
            <button
              onClick={() => { onMoveDown(); }}
              disabled={isLast}
              className="toy-cmd"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              {s['tierEdit.moveDown']}
            </button>
            <button
              onClick={() => { onInsertAbove(); setIsOpen(false); }}
              className="toy-cmd"
            >
              <Plus className="w-3.5 h-3.5" />
              {s['tierEdit.addAbove']}
            </button>
            <button
              onClick={() => { onInsertBelow(); setIsOpen(false); }}
              className="toy-cmd"
            >
              <Plus className="w-3.5 h-3.5" />
              {s['tierEdit.addBelow']}
            </button>
          </div>

          {/* Delete */}
          {canDelete && (
            <button
              onClick={() => { onDelete(); setIsOpen(false); }}
              className="toy-cmd toy-cmd--drop"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {s['tierEdit.deleteTier']}
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
