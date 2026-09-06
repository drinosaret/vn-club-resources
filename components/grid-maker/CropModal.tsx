'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import { X, RotateCcw, ZoomIn, Type, Star, ExternalLink } from 'lucide-react';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import type { GridItem, CropData } from '@/hooks/useGridMakerState';
import { useLocale } from '@/lib/i18n/locale-context';
import { gridMakerStrings } from '@/lib/i18n/translations/grid-maker';
import { t } from '@/lib/i18n/types';
import { CoverPicker } from '@/components/shared/CoverPicker';

interface CropModalProps {
  item: GridItem;
  cropSquare: boolean;
  onSave: (data: { cropData?: CropData; cropPreview?: string; cropPreviewTiny?: string; customTitle?: string; vote?: number; imageUrl?: string; imageSexual?: number }) => void;
  onCancel: () => void;
}

/** Generate cropped preview blob URLs from a loaded image URL + crop area (percentages). */
function generateCropPreview(
  imageUrl: string,
  croppedArea: { x: number; y: number; width: number; height: number },
): Promise<{ preview: string; tiny: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const sx = (croppedArea.x / 100) * img.naturalWidth;
      const sy = (croppedArea.y / 100) * img.naturalHeight;
      const sw = (croppedArea.width / 100) * img.naturalWidth;
      const sh = (croppedArea.height / 100) * img.naturalHeight;

      const cropAspect = sw / sh;
      const tw = cropAspect >= 1 ? 400 : Math.round(400 * cropAspect);
      const th = cropAspect >= 1 ? Math.round(400 / cropAspect) : 400;

      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);

      const tinyCanvas = document.createElement('canvas');
      tinyCanvas.width = 20;
      tinyCanvas.height = Math.round(20 / cropAspect);
      tinyCanvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, tinyCanvas.width, tinyCanvas.height);

      canvas.toBlob(
        blob => {
          if (!blob) { reject(new Error('toBlob failed')); return; }
          const previewUrl = URL.createObjectURL(blob);
          tinyCanvas.toBlob(
            tinyBlob => {
              resolve({
                preview: previewUrl,
                tiny: tinyBlob ? URL.createObjectURL(tinyBlob) : previewUrl,
              });
            },
            'image/webp',
            0.5,
          );
        },
        'image/webp',
        0.9,
      );
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = imageUrl.replace(/w=\d+/, 'w=512');
  });
}

function getCropImageUrl(url: string): string {
  return url.replace(/w=\d+/, 'w=512');
}

export function CropModal({ item, cropSquare, onSave, onCancel }: CropModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);
  const { preference } = useTitlePreference();
  const locale = useLocale();
  const s = gridMakerStrings[locale];

  const [crop, setCrop] = useState<Point>(item.cropData?.crop ?? { x: 0, y: 0 });
  const [zoom, setZoom] = useState(item.cropData?.zoom ?? 1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(item.cropData?.croppedArea ?? null);
  const [titleInput, setTitleInput] = useState(item.customTitle ?? '');
  const [voteInput, setVoteInput] = useState(item.vote != null ? String(item.vote) : '');
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [selectedImageSexual, setSelectedImageSexual] = useState<number>(0);

  const aspect = cropSquare ? 1 : 2 / 3;

  // Resolved auto title (used as placeholder when no custom title)
  const autoTitle = (item.titleJp || item.titleRomaji)
    ? getDisplayTitle({ title: item.title, title_jp: item.titleJp, title_romaji: item.titleRomaji }, preference)
    : item.title;

  const isVN = item.id.startsWith('v');
  const numericId = item.id.replace(/^[vc]/, '');
  const pageUrl = isVN ? `/vn/${numericId}/` : `/character/${numericId}/`;
  const vndbUrl = `https://vndb.org/${item.id}`;
  const displayTitle = item.customTitle || autoTitle;

  const altTitle = (item.titleJp || item.titleRomaji)
    ? getDisplayTitle({ title: item.title, title_jp: item.titleJp, title_romaji: item.titleRomaji }, preference === 'romaji' ? 'japanese' : 'romaji')
    : null;
  const showAltTitle = altTitle && altTitle !== displayTitle;

  const handleCropComplete = useCallback((_croppedArea: Area, _croppedAreaPixels: Area) => {
    setCroppedArea(_croppedArea);
  }, []);

  const handleReset = useCallback(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  const voteNum = voteInput.trim() ? parseInt(voteInput, 10) : null;
  const voteError = voteInput.trim() && (voteNum == null || isNaN(voteNum) || voteNum < 10 || voteNum > 100);

  const effectiveImageUrl = selectedImageUrl ?? item.imageUrl;

  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (voteError || saving) return;
    const customTitle = titleInput.trim() || undefined;
    const vote = voteNum != null && voteNum >= 10 && voteNum <= 100 ? voteNum : undefined;
    const data: Parameters<typeof onSave>[0] = { customTitle, vote };
    if (effectiveImageUrl) {
      data.cropData = croppedArea ? { crop, zoom, croppedArea } : undefined;
    }
    if (selectedImageUrl) {
      data.imageUrl = selectedImageUrl;
      data.imageSexual = selectedImageSexual;
    }
    // Generate crop preview before closing so GridCell has it immediately
    if (data.cropData && effectiveImageUrl) {
      setSaving(true);
      try {
        const { preview, tiny } = await generateCropPreview(effectiveImageUrl, data.cropData.croppedArea);
        data.cropPreview = preview;
        data.cropPreviewTiny = tiny;
      } catch {
        // Fall back to no preview; GridCell will generate async
      }
      setSaving(false);
    }
    onSave(data);
  }, [crop, zoom, croppedArea, titleInput, voteNum, voteError, saving, effectiveImageUrl, selectedImageUrl, selectedImageSexual, onSave]);

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  // Body scroll lock + focus management
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

  const imageUrl = effectiveImageUrl ? getCropImageUrl(effectiveImageUrl) : null;

  return createPortal(
    <div className="toy-scrim" role="dialog" aria-modal="true" aria-labelledby="crop-modal-title">
      {/* Backdrop */}
      <div className="toy-scrim-fill" onClick={onCancel} />

      {/* Modal */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className="toy-modal toy-modal--lg outline-hidden"
        style={{ maxHeight: 'min(90vh, 750px)' }}
      >
        {/* Header */}
        <div className="toy-modal-head">
          <h3 id="crop-modal-title" className="toy-modal-title">
            {t(s, 'crop.editTitle', { title: displayTitle })}
          </h3>
          <button onClick={onCancel} className="toy-x" aria-label={s['crop.cancel']}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Title + Score inputs */}
        <div className="px-4 py-3 border-b border-[color:var(--rule)] space-y-2 overflow-y-auto max-h-[45%]">
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
                title={s['crop.resetAutoTitle']}
                aria-label={s['crop.resetAutoTitle']}
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
              placeholder={s['crop.scorePlaceholder']}
              className={`toy-field w-32 tabular-nums ${voteError ? 'toy-field--bad' : ''}`}
            />
            {voteInput && (
              <button
                onClick={() => setVoteInput('')}
                className="toy-x"
                title={s['crop.clearScore']}
                aria-label={s['crop.clearScore']}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </label>
          {item.id.startsWith('v') && (
            <CoverPicker
              vnId={item.id}
              currentImageUrl={effectiveImageUrl}
              originalImageUrl={item.defaultImageUrl ?? item.imageUrl}
              originalImageSexual={item.imageSexual ?? undefined}
              onSelect={(url, sexual) => {
                setSelectedImageUrl(url);
                setSelectedImageSexual(sexual);
                setCrop({ x: 0, y: 0 });
                setZoom(1);
              }}
            />
          )}
        </div>

        {/* Cropper area */}
        {imageUrl && (
          <div className="relative flex-1 min-h-[200px] bg-[color:var(--box)]">
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
              objectFit="contain"
              showGrid={false}
            />
          </div>
        )}

        {/* Controls */}
        <div className="px-4 py-3 border-t border-[color:var(--rule)] shrink-0 space-y-3">
          {/* Zoom slider: only when image exists */}
          {imageUrl && (
            <div className="flex items-center gap-3">
              <ZoomIn className="w-4 h-4 shrink-0 text-[color:var(--nezu)]" />
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                className="rc-range flex-1"
              />
              <span className="w-10 text-right font-mono text-xs tabular-nums text-[color:var(--nezu)]">
                {zoom.toFixed(1)}x
              </span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-between">
            {imageUrl ? (
              <button
                onClick={handleReset}
                className="toy-btn"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {s['crop.resetCrop']}
              </button>
            ) : <div />}
            <div className="flex items-center gap-2">
              <button
                onClick={onCancel}
                className="toy-btn"
              >
                {s['crop.cancel']}
              </button>
              <button
                onClick={handleSave}
                disabled={!!voteError}
                className="toy-btn toy-btn--go"
              >
                {s['crop.save']}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
