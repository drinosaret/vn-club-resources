'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCcw, Type, Star } from 'lucide-react';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';
import { t } from '@/lib/i18n/types';
import type { TierVN } from '@/lib/tier-config';
import { CoverPicker } from '@/components/shared/CoverPicker';

interface VNEditModalProps {
  vn: TierVN;
  onSave: (data: { customTitle?: string; vote?: number; imageUrl?: string; imageSexual?: number }) => void;
  onCancel: () => void;
}

export function VNEditModal({ vn, onSave, onCancel }: VNEditModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);
  const { preference } = useTitlePreference();
  const locale = useLocale();
  const s = tierListStrings[locale];

  const [titleInput, setTitleInput] = useState(vn.customTitle ?? '');
  const [voteInput, setVoteInput] = useState(vn.vote != null ? String(vn.vote) : '');
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [selectedImageSexual, setSelectedImageSexual] = useState<number>(0);

  const autoTitle = (vn.titleJp || vn.titleRomaji)
    ? getDisplayTitle({ title: vn.title, title_jp: vn.titleJp, title_romaji: vn.titleRomaji }, preference)
    : vn.title;

  const voteNum = voteInput.trim() ? parseInt(voteInput, 10) : null;
  const voteError = voteInput.trim() && (voteNum == null || isNaN(voteNum) || voteNum < 10 || voteNum > 100);

  const handleSave = useCallback(() => {
    if (voteError) return;
    const customTitle = titleInput.trim() || undefined;
    const vote = voteNum != null && voteNum >= 10 && voteNum <= 100 ? voteNum : undefined;
    onSave({
      customTitle, vote,
      ...(selectedImageUrl ? { imageUrl: selectedImageUrl, imageSexual: selectedImageSexual } : {}),
    });
  }, [titleInput, voteNum, voteError, selectedImageUrl, selectedImageSexual, onSave]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    previousActiveElement.current = document.activeElement;
    modalRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="vn-edit-modal-title">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />

      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden outline-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h3 id="vn-edit-modal-title" className="text-sm font-semibold text-gray-900 dark:text-white truncate pr-2">
            {t(s, 'editModal.header', { title: vn.customTitle || autoTitle })}
          </h3>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Inputs */}
        <div className="px-4 py-3 space-y-2">
          {(selectedImageUrl ?? vn.imageUrl) && (
            <div className="flex justify-center pb-1">
              <img
                src={`${selectedImageUrl ?? vn.imageUrl}${(selectedImageUrl ?? vn.imageUrl)!.includes('?') ? '&' : '?'}w=256`}
                alt=""
                className="h-28 rounded shadow-sm"
              />
            </div>
          )}
          <label className="flex items-center gap-2">
            <Type className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              type="text"
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              placeholder={autoTitle}
              className="flex-1 px-2 py-1 text-sm rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
            {titleInput && (
              <button
                onClick={() => setTitleInput('')}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
                title={s['editModal.resetTitle']}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </label>
          <label className="flex items-center gap-2">
            <Star className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              type="number"
              min={10}
              max={100}
              value={voteInput}
              onChange={e => setVoteInput(e.target.value)}
              placeholder={s['editModal.scorePlaceholder']}
              className={`w-32 px-2 py-1 text-sm rounded border ${voteError ? 'border-red-400 dark:border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-200 dark:border-gray-700 focus:ring-blue-500 focus:border-blue-500'} bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-1 tabular-nums`}
            />
            {voteInput && (
              <button
                onClick={() => setVoteInput('')}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
                title={s['editModal.clearScore']}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </label>
          {vn.id.startsWith('v') && (
            <CoverPicker
              vnId={vn.id}
              currentImageUrl={selectedImageUrl ?? vn.imageUrl}
              originalImageUrl={vn.defaultImageUrl ?? vn.imageUrl}
              originalImageSexual={vn.imageSexual ?? undefined}
              onSelect={(url, sexual) => {
                setSelectedImageUrl(url);
                setSelectedImageSexual(sexual);
              }}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            {s['editModal.cancel']}
          </button>
          <button
            onClick={handleSave}
            disabled={!!voteError}
            className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {s['editModal.save']}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
