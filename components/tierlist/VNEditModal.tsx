'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCcw, Type, Star, ExternalLink } from 'lucide-react';
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

  const isVN = vn.id.startsWith('v');
  const numericId = vn.id.replace(/^[vc]/, '');
  const pageUrl = isVN ? `/vn/${numericId}/` : `/character/${numericId}/`;
  const vndbUrl = `https://vndb.org/${vn.id}`;

  // Alternate title: show the other language
  const altTitle = (vn.titleJp || vn.titleRomaji)
    ? getDisplayTitle({ title: vn.title, title_jp: vn.titleJp, title_romaji: vn.titleRomaji }, preference === 'romaji' ? 'japanese' : 'romaji')
    : null;
  const displayTitle = vn.customTitle || autoTitle;
  const showAltTitle = altTitle && altTitle !== displayTitle;

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
    <div className="toy-scrim" role="dialog" aria-modal="true" aria-labelledby="vn-edit-modal-title">
      <div className="toy-scrim-fill" onClick={onCancel} />

      <div
        ref={modalRef}
        tabIndex={-1}
        className="toy-modal toy-modal--sm outline-hidden"
      >
        {/* Header */}
        <div className="toy-modal-head">
          <h3 id="vn-edit-modal-title" className="toy-modal-title">
            {t(s, 'editModal.header', { title: displayTitle })}
          </h3>
          <button onClick={onCancel} className="toy-x" aria-label={s['editModal.cancel']}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Inputs */}
        <div className="px-4 py-3 space-y-2">
          {(selectedImageUrl ?? vn.imageUrl) && (
            <div className="flex justify-center pb-1">
              <img
                src={`${selectedImageUrl ?? vn.imageUrl}${(selectedImageUrl ?? vn.imageUrl)!.includes('?') ? '&' : '?'}w=256`}
                alt=""
                className="h-28 rounded-xs border border-[color:var(--rule)]"
              />
            </div>
          )}
          <div className="flex flex-col items-center gap-1.5">
            {showAltTitle && <span className="max-w-full truncate text-xs text-[color:var(--nezu)]">{altTitle}</span>}
            <div className="flex items-center gap-2">
              <a
                href={pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="toy-btn"
              >
                VN Club
                <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href={vndbUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="toy-btn"
              >
                VNDB
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
          <label className="flex items-center gap-2">
            <Type className="w-4 h-4 shrink-0 text-[color:var(--nezu)]" />
            <input
              type="text"
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              placeholder={autoTitle}
              className="toy-field flex-1 min-w-0"
            />
            {titleInput && (
              <button
                onClick={() => setTitleInput('')}
                className="toy-x"
                title={s['editModal.resetTitle']}
                aria-label={s['editModal.resetTitle']}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </label>
          <label className="flex items-center gap-2">
            <Star className="w-4 h-4 shrink-0 text-[color:var(--nezu)]" />
            <input
              type="number"
              min={10}
              max={100}
              value={voteInput}
              onChange={e => setVoteInput(e.target.value)}
              placeholder={s['editModal.scorePlaceholder']}
              className={`toy-field w-32 tabular-nums ${voteError ? 'toy-field--bad' : ''}`}
            />
            {voteInput && (
              <button
                onClick={() => setVoteInput('')}
                className="toy-x"
                title={s['editModal.clearScore']}
                aria-label={s['editModal.clearScore']}
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
        <div className="toy-modal-foot justify-end">
          <button onClick={onCancel} className="toy-btn">
            {s['editModal.cancel']}
          </button>
          <button
            onClick={handleSave}
            disabled={!!voteError}
            className="toy-btn toy-btn--go"
          >
            {s['editModal.save']}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
