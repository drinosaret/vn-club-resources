import { useState, useCallback } from 'react';
import { getDisplayTitle, type TitlePreference } from '@/lib/title-preference';
import { NSFW_THRESHOLD } from '@/lib/nsfw-reveal';
import type { GridItem, CropData } from '@/hooks/useGridMakerState';

function readTitlePreference(): TitlePreference {
  try {
    const stored = localStorage.getItem('vn-title-preference');
    if (stored === 'japanese' || stored === 'romaji') return stored;
  } catch { /* ignore */ }
  return 'romaji';
}

function resolveItemTitle(item: GridItem): string {
  if (item.customTitle) return item.customTitle;
  if (item.titleJp || item.titleRomaji) {
    const pref = readTitlePreference();
    return getDisplayTitle({ title: item.title, title_jp: item.titleJp, title_romaji: item.titleRomaji }, pref) || item.title;
  }
  return item.title;
}

const CELL_SIZE = 400;

/** Polyfill for CanvasRenderingContext2D.roundRect (Chrome 99+, Firefox 112+, Safari 15.4+) */
function safeRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

export interface ExportNSFWState {
  allRevealed: boolean;
  isRevealed: (id: string) => boolean;
}

function drawPixelated(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number, y: number,
  w: number, h: number,
  cropData?: CropData,
) {
  // Draw full image (with crop) to a ~20px canvas, then nearest-neighbor upscale
  const tinyW = 20;
  const tinyH = Math.round(tinyW * (h / w));
  const tiny = document.createElement('canvas');
  tiny.width = tinyW;
  tiny.height = tinyH;
  const tctx = tiny.getContext('2d')!;
  drawImageCover(tctx, img, 0, 0, tinyW, tinyH, cropData);

  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiny, 0, 0, tinyW, tinyH, x, y, w, h);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(x, y, w, h);
  ctx.imageSmoothingEnabled = prev;
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number, y: number,
  w: number, h: number,
  cropData?: CropData,
) {
  if (cropData) {
    // Use exact crop area from the crop modal (percentages → pixels)
    const { croppedArea } = cropData;
    const sx = (croppedArea.x / 100) * img.naturalWidth;
    const sy = (croppedArea.y / 100) * img.naturalHeight;
    const sw = (croppedArea.width / 100) * img.naturalWidth;
    const sh = (croppedArea.height / 100) * img.naturalHeight;
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    return;
  }

  // Default center crop (no cropData)
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const cellAspect = w / h;
  let sx: number, sy: number, sw: number, sh: number;

  if (imgAspect > cellAspect) {
    sh = img.naturalHeight;
    sw = sh * cellAspect;
    sx = (img.naturalWidth - sw) * 0.5;
    sy = 0;
  } else {
    sw = img.naturalWidth;
    sh = sw / cellAspect;
    sx = 0;
    sy = (img.naturalHeight - sh) * 0.5;
  }

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function loadImage(url: string, timeout = 8000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('load failed')); };
    img.src = url;
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text];

  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const test = current + ch;

    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = ch;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  return lines.length > 0 ? lines : [text.slice(0, 1)];
}

function getExportUrl(url: string): string {
  return url.replace(/w=\d+/, 'w=512');
}

export type GridExportFormat = 'jpeg' | 'png' | 'webp';

export function useGridExport(
  gridSize: number,
  cells: (string | null)[],
  itemMap: Record<string, GridItem>,
  username: string,
  mode: string,
  cropSquare: boolean,
  showFrame: boolean,
  showTitles: boolean,
  showScores: boolean,
  gridTitle: string,
  titleMaxH: number,
  nsfwState?: ExportNSFWState,
) {
  const [exporting, setExporting] = useState(false);

  const renderToCanvas = useCallback(async (): Promise<HTMLCanvasElement> => {
    const gap = showFrame ? 6 : 0;
    const cellW = CELL_SIZE;
    const cellH = cropSquare ? CELL_SIZE : Math.round(CELL_SIZE * 1.5);
    const titleBarH = gridTitle.trim() ? 72 : 0;

    const canvasW = gridSize * cellW + (gridSize - 1) * gap;
    const canvasH = titleBarH + gridSize * cellH + (gridSize - 1) * gap;

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;

    // Background
    const isDark = document.documentElement.classList.contains('dark');
    ctx.fillStyle = isDark ? '#111827' : '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Title bar
    if (gridTitle.trim()) {
      ctx.fillStyle = isDark ? '#1f2937' : '#f3f4f6';
      ctx.fillRect(0, 0, canvasW, titleBarH);
      ctx.fillStyle = isDark ? '#f3f4f6' : '#111827';
      ctx.font = 'bold 32px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(gridTitle.trim(), canvasW / 2, titleBarH / 2, canvasW - 40);
    }

    // Load all images in parallel
    const imageResults = await Promise.all(
      cells.map(async (itemId, i) => {
        if (!itemId) return { index: i, img: null };
        const item = itemMap[itemId];
        if (!item?.imageUrl) return { index: i, img: null };
        try {
          const img = await loadImage(getExportUrl(item.imageUrl));
          return { index: i, img };
        } catch {
          return { index: i, img: null };
        }
      })
    );

    // Draw images
    for (const { index, img } of imageResults) {
      const itemId = cells[index];
      const item = itemId ? itemMap[itemId] : null;
      const row = Math.floor(index / gridSize);
      const col = index % gridSize;
      const x = col * (cellW + gap);
      const y = titleBarH + row * (cellH + gap);

      // Draw placeholder for cells with items but failed image loads
      if (!img) {
        if (item) {
          ctx.fillStyle = isDark ? '#374151' : '#d1d5db';
          ctx.fillRect(x, y, cellW, cellH);
          ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280';
          ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const title = resolveItemTitle(item);
          ctx.fillText(title, x + cellW / 2, y + cellH / 2, cellW - 16);
        }
        continue;
      }

      const isNsfw = (item?.imageSexual ?? 0) >= NSFW_THRESHOLD;
      const isRevealed = item && nsfwState ? nsfwState.allRevealed || nsfwState.isRevealed(item.id) : true;
      if (isNsfw && !isRevealed) {
        drawPixelated(ctx, img, x, y, cellW, cellH, item?.cropData);
      } else {
        drawImageCover(ctx, img, x, y, cellW, cellH, item?.cropData);
      }

      // Score badge
      if (showScores && item?.vote) {
        const text = String(item.vote);
        ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
        const textW = ctx.measureText(text).width;
        const badgeW = textW + 16;
        const badgeH = 34;
        const bx = x + 8;
        const by = y + 8;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.beginPath();
        safeRoundRect(ctx, bx, by, badgeW, badgeH, 14);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + badgeW / 2, by + badgeH / 2);
      }

      // Title overlay
      if (showTitles && item) {
        const titleText = resolveItemTitle(item);
        if (titleText) {
          ctx.font = 'bold 20px system-ui, -apple-system, sans-serif';
          const lineH = Math.round(20 * 1.25);
          const padY = 2;
          const maxBarH = Math.floor(cellH * (titleMaxH / 100));
          const allLines = wrapText(ctx, titleText, cellW - 16, 20);
          const fittableLines = Math.max(1, Math.floor((maxBarH - padY * 2) / lineH));
          const titleLines = allLines.slice(0, fittableLines);
          const barH = titleLines.length * lineH + padY * 2;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
          ctx.fillRect(x, y + cellH - barH, cellW, barH);
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (let li = 0; li < titleLines.length; li++) {
            ctx.fillText(titleLines[li], x + cellW / 2, y + cellH - barH + padY + lineH * (li + 0.5), cellW - 16);
          }
        }
      }
    }

    return canvas;
  }, [gridSize, cells, itemMap, cropSquare, showFrame, showTitles, showScores, gridTitle, titleMaxH, nsfwState]);

  const generateBlob = useCallback(async (): Promise<Blob> => {
    const canvas = await renderToCanvas();
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob failed'));
      }, 'image/png');
    });
  }, [renderToCanvas]);

  const exportAsImage = useCallback(async (format: GridExportFormat = 'jpeg') => {
    setExporting(true);
    try {
      const canvas = await renderToCanvas();
      const mimeType = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
      const quality = format === 'png' ? undefined : 0.92;
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), mimeType, quality);
      });
      const prefix = mode === 'characters' ? 'char' : 'vn';
      const userPart = (username || 'grid').replace(/[^a-zA-Z0-9_-]/g, '_');
      const ext = format === 'png' ? 'png' : format === 'webp' ? 'webp' : 'jpg';
      const filename = `${prefix}-${gridSize}x${gridSize}-${userPart}-${new Date().toISOString().slice(0, 10)}.${ext}`;
      const file = new File([blob], filename, { type: mimeType });
      const fileUrl = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.download = filename;
      link.href = fileUrl;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(fileUrl);
      }, 200);
    } catch (err) {
      console.error('Grid export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [renderToCanvas, mode, username, gridSize]);

  return { exporting, exportAsImage, generateBlob };
}
