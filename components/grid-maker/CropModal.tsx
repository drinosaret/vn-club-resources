'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import { X, RotateCcw, ZoomIn, Type, Star } from 'lucide-react';
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
        // Fall back to no preview — GridCell will generate async
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="crop-modal-title">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />

      {/* Modal */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden outline-hidden flex flex-col"
        style={{ maxHeight: 'min(85vh, 640px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h3 id="crop-modal-title" className="text-sm font-semibold text-gray-900 dark:text-white truncate pr-2">
            {t(s, 'crop.editTitle', { title: item.customTitle || autoTitle })}
          </h3>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Title + Score inputs */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0 space-y-2">
          <label className="flex items-center gap-2">
            <Type className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              type="text"
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              placeholder={autoTitle}
              className="flex-1 px-2 py-1 text-sm rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
            />
            {titleInput && (
              <button
                onClick={() => setTitleInput('')}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
                title={s['crop.resetAutoTitle']}
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
              placeholder={s['crop.scorePlaceholder']}
              className={`w-32 px-2 py-1 text-sm rounded border ${voteError ? 'border-red-400 dark:border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-200 dark:border-gray-700 focus:ring-purple-500 focus:border-purple-500'} bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-1 tabular-nums`}
            />
            {voteInput && (
              <button
                onClick={() => setVoteInput('')}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
                title={s['crop.clearScore']}
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
          <div className="relative flex-1 min-h-[300px] bg-gray-950">
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
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0 space-y-3">
          {/* Zoom slider — only when image exists */}
          {imageUrl && (
            <div className="flex items-center gap-3">
              <ZoomIn className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                className="flex-1 accent-purple-600"
              />
              <span className="text-xs text-gray-500 dark:text-gray-400 w-10 text-right tabular-nums">
                {zoom.toFixed(1)}x
              </span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-between">
            {imageUrl ? (
              <button
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {s['crop.resetCrop']}
              </button>
            ) : <div />}
            <div className="flex items-center gap-2">
              <button
                onClick={onCancel}
                className="px-4 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                {s['crop.cancel']}
              </button>
              <button
                onClick={handleSave}
                disabled={!!voteError}
                className="px-4 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
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
