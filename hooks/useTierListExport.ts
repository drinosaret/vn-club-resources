import { useState, useCallback, useRef } from 'react';
import { getDisplayTitle, type TitlePreference } from '@/lib/title-preference';
import { NSFW_THRESHOLD } from '@/lib/nsfw-reveal';
import type { TierDef, TierVN, SizeConfig } from '@/lib/tier-config';

function readTitlePreference(): TitlePreference {
  try {
    const stored = localStorage.getItem('vn-title-preference');
    if (stored === 'japanese' || stored === 'romaji') return stored;
  } catch { /* ignore */ }
  return 'romaji';
}

// Layout constants (fixed across all sizes)
const LABEL_W = 80;
const TITLE_H = 32;
const BORDER = 2;
const CANVAS_W = 1200;

// Tailwind class → hex color map
const COLOR_MAP: Record<string, string> = {
  'bg-red-400': '#f87171',
  'bg-orange-400': '#fb923c',
  'bg-amber-400': '#fbbf24',
  'bg-yellow-300': '#fde047',
  'bg-lime-400': '#a3e635',
  'bg-green-400': '#4ade80',
  'bg-teal-400': '#2dd4bf',
  'bg-blue-400': '#60a5fa',
  'bg-purple-400': '#c084fc',
  'bg-pink-400': '#f472b6',
  'bg-gray-300': '#d1d5db',
  'bg-gray-600': '#4b5563',
};

const TEXT_COLOR_MAP: Record<string, string> = {
  'text-red-950': '#450a0a',
  'text-orange-950': '#431407',
  'text-amber-950': '#451a03',
  'text-yellow-950': '#422006',
  'text-lime-950': '#1a2e05',
  'text-green-950': '#052e16',
  'text-teal-950': '#042f2e',
  'text-blue-950': '#172554',
  'text-purple-950': '#3b0764',
  'text-pink-950': '#500724',
  'text-gray-700': '#374151',
  'text-gray-200': '#e5e7eb',
};

function resolveBgColor(colorClass: string, isDark: boolean): string {
  // Handle "bg-gray-300 dark:bg-gray-600" pattern
  if (colorClass.includes(' dark:')) {
    const parts = colorClass.split(' ');
    const lightClass = parts[0];
    const darkClass = parts.find(p => p.startsWith('dark:'))?.replace('dark:', '') ?? lightClass;
    return COLOR_MAP[isDark ? darkClass : lightClass] ?? '#888888';
  }
  return COLOR_MAP[colorClass] ?? '#888888';
}

function resolveTextColor(textClass: string, isDark: boolean): string {
  if (textClass.includes(' dark:')) {
    const parts = textClass.split(' ');
    const lightClass = parts[0];
    const darkClass = parts.find(p => p.startsWith('dark:'))?.replace('dark:', '') ?? lightClass;
    return TEXT_COLOR_MAP[isDark ? darkClass : lightClass] ?? '#000000';
  }
  return TEXT_COLOR_MAP[textClass] ?? '#000000';
}

/** Break text into lines that fit within maxWidth, wrapping character-by-character for CJK. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  // Fast path — fits in one line
  if (ctx.measureText(text).width <= maxWidth) return [text];

  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const test = current + ch;

    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      // Current line is full — push it and start new line
      if (current) lines.push(current);
      current = ch;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  return lines.length > 0 ? lines : [text.slice(0, 1)];
}

/** Truncate a single line of text with "…" if it exceeds maxWidth. */
function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 0 && ctx.measureText(text + '…').width > maxWidth) {
    text = text.slice(0, -1).trimEnd();
  }
  return text + '…';
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

function getExportUrl(url: string): string {
  return url.replace(/w=\d+/, 'w=512');
}


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
) {
  // Draw full image to a ~20px canvas, then nearest-neighbor upscale
  const tinyW = 20;
  const tinyH = Math.round(tinyW * (h / w));
  const tiny = document.createElement('canvas');
  tiny.width = tinyW;
  tiny.height = tinyH;
  const tctx = tiny.getContext('2d')!;
  // Center-crop into tiny canvas (bias top for VN covers)
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
    sy = (img.naturalHeight - sh) * 0.2;
  }
  tctx.drawImage(img, sx, sy, sw, sh, 0, 0, tinyW, tinyH);

  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiny, 0, 0, tinyW, tinyH, x, y, w, h);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(x, y, w, h);
  ctx.imageSmoothingEnabled = prev;
}

export type ExportFormat = 'jpeg' | 'png' | 'webp';
export type ExportScale = 1 | 1.5 | 2;

export function useTierListExport(
  tierDefs: TierDef[],
  tiers: Record<string, string[]>,
  vnMap: Record<string, TierVN>,
  username: string,
  displayMode: string,
  showTitles: boolean,
  showScores: boolean,
  sizeConfig: SizeConfig,
  listTitle: string,
  titleMaxH: number,
  exportScale: ExportScale = 2,
  nsfwState?: ExportNSFWState,
) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showExportError = useCallback((msg: string) => {
    clearTimeout(errorTimerRef.current);
    setExportError(msg);
    errorTimerRef.current = setTimeout(() => setExportError(null), 5000);
  }, []);
  const dismissExportError = useCallback(() => {
    clearTimeout(errorTimerRef.current);
    setExportError(null);
  }, []);

  // WebP has a hard 16383x16383 pixel limit in its bitstream spec.
  const MAX_WEBP = 16383;
  const checkWebPLimits = useCallback((canvas: HTMLCanvasElement, format: string): boolean => {
    if (format === 'webp' && (canvas.width > MAX_WEBP || canvas.height > MAX_WEBP)) {
      showExportError('Image too large for WebP (max 16383px per side). Use JPG or PNG instead.');
      return false;
    }
    return true;
  }, [showExportError]);

  const renderToCanvas = useCallback(async (): Promise<HTMLCanvasElement> => {
    const isDark = document.documentElement.classList.contains('dark');
    const bgColor = isDark ? '#111827' : '#ffffff';
    const isCovers = displayMode === 'covers';
    const { itemW: ITEM_W, itemH: ITEM_H, minRowH: MIN_ROW_H, gap: GAP, pad: PAD, scoreFontSize, titleFontSize } = sizeConfig.export;
    // Cache title preference once for the entire export (avoids 200+ localStorage reads)
    const titlePref = readTitlePreference();
    const getTitle = (vn: TierVN) => {
      if (vn.customTitle) return vn.customTitle;
      if (vn.titleJp || vn.titleRomaji) {
        return getDisplayTitle({ title: vn.title, title_jp: vn.titleJp, title_romaji: vn.titleRomaji }, titlePref) || vn.title;
      }
      return vn.title;
    };
    const itemW = isCovers ? ITEM_W : 0; // titles mode uses variable widths
    const itemH = isCovers ? ITEM_H : TITLE_H;
    const BADGE_HPAD = 16; // horizontal padding inside each title badge
    const BADGE_RADIUS = 6;

    // Use the full CANVAS_W to determine how many columns fit, then shrink
    // the canvas to tightly fit the actual widest row (covers mode only).
    const fullItemsAreaW = CANVAS_W - LABEL_W;
    const cols = isCovers ? Math.max(1, Math.floor((fullItemsAreaW - PAD * 2 + GAP) / (itemW + GAP))) : 0;
    let canvasW = CANVAS_W;
    if (isCovers) {
      const maxUsedCols = Math.max(1, ...tierDefs.map(t => Math.min(cols, (tiers[t.id] ?? []).length)));
      canvasW = LABEL_W + PAD * 2 + maxUsedCols * itemW + (maxUsedCols - 1) * GAP;
    }
    const itemsAreaW = canvasW - LABEL_W;

    // For titles mode, pre-measure all badge widths so we can flow-wrap
    const measureCtx = document.createElement('canvas').getContext('2d')!;
    measureCtx.font = '12px system-ui, -apple-system, sans-serif';
    // badgeWidths[tierId] = array of measured widths per VN
    const badgeWidths = new Map<string, number[]>();
    if (!isCovers) {
      for (const tier of tierDefs) {
        const vnIds = tiers[tier.id] ?? [];
        const widths: number[] = [];
        for (const vnId of vnIds) {
          const vn = vnMap[vnId];
          if (!vn) { widths.push(60); continue; }
          const titleText = getTitle(vn);
          const labelText = showScores && vn.vote ? `${titleText} (${vn.vote})` : titleText;
          widths.push(Math.ceil(measureCtx.measureText(labelText).width) + BADGE_HPAD);
        }
        badgeWidths.set(tier.id, widths);
      }
    }

    // Flow-wrap helper: returns number of lines needed for variable-width badges
    function flowLineCount(widths: number[], areaW: number, gap: number): number {
      if (widths.length === 0) return 1;
      let lines = 1;
      let x = 0;
      for (const w of widths) {
        if (x > 0 && x + gap + w > areaW) { lines++; x = w; }
        else { x += (x > 0 ? gap : 0) + w; }
      }
      return lines;
    }

    // Calculate row heights
    const rows: { tier: TierDef; vnIds: string[]; height: number }[] = [];
    for (const tier of tierDefs) {
      const vnIds = tiers[tier.id] ?? [];
      if (isCovers) {
        const rowCount = Math.max(1, Math.ceil(vnIds.length / cols));
        const contentH = rowCount * itemH + (rowCount - 1) * GAP + PAD * 2;
        rows.push({ tier, vnIds, height: Math.max(MIN_ROW_H, contentH) });
      } else {
        const widths = badgeWidths.get(tier.id) ?? [];
        const lineCount = flowLineCount(widths, itemsAreaW - PAD * 2, GAP);
        const contentH = lineCount * TITLE_H + (lineCount - 1) * GAP + PAD * 2;
        rows.push({ tier, vnIds, height: Math.max(MIN_ROW_H, contentH) });
      }
    }

    const headerH = listTitle.trim() ? 72 : 0;
    const totalH = headerH + rows.reduce((sum, r) => sum + r.height, 0) + (rows.length - 1) * BORDER;

    const scale = exportScale;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(canvasW * scale);
    canvas.height = Math.round(totalH * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvasW, totalH);

    // Title header
    if (listTitle.trim()) {
      ctx.fillStyle = isDark ? '#1f2937' : '#f3f4f6';
      ctx.fillRect(0, 0, canvasW, headerH);
      ctx.fillStyle = isDark ? '#f3f4f6' : '#111827';
      ctx.font = 'bold 32px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(listTitle.trim(), canvasW / 2, headerH / 2, canvasW - 40);
    }

    // Collect all image URLs to load in parallel
    const imageUrls = new Set<string>();
    for (const { vnIds } of rows) {
      for (const vnId of vnIds) {
        const vn = vnMap[vnId];
        if (vn?.imageUrl && isCovers) imageUrls.add(getExportUrl(vn.imageUrl));
      }
    }

    const imageCache = new Map<string, HTMLImageElement>();
    await Promise.allSettled(
      [...imageUrls].map(async url => {
        const img = await loadImage(url);
        imageCache.set(url, img);
      })
    );

    // Draw rows
    let y = headerH;
    for (let ri = 0; ri < rows.length; ri++) {
      const { tier, vnIds, height } = rows[ri];

      // Tier label background
      const labelBg = resolveBgColor(tier.color, isDark);
      ctx.fillStyle = labelBg;
      ctx.fillRect(0, y, LABEL_W, height);

      // Tier label text — wrap if too wide
      const labelColor = resolveTextColor(tier.textColor, isDark);
      ctx.fillStyle = labelColor;
      ctx.textAlign = 'center';
      const maxLabelW = LABEL_W - 8;
      // Pick font size: shrink for longer labels
      const labelFontSize = tier.label.length > 6 ? 14 : tier.label.length > 3 ? 20 : 28;
      ctx.font = `bold ${labelFontSize}px system-ui, -apple-system, sans-serif`;
      // Word-wrap the label into lines
      const words = tier.label.split(/\s+/);
      const labelLines: string[] = [];
      let currentLine = '';
      for (const word of words) {
        const test = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(test).width <= maxLabelW || !currentLine) {
          currentLine = test;
        } else {
          labelLines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) labelLines.push(currentLine);
      const lineH = labelFontSize * 1.2;
      const totalTextH = labelLines.length * lineH;
      const startY = y + (height - totalTextH) / 2 + labelFontSize * 0.6;
      ctx.textBaseline = 'middle';
      for (let li = 0; li < labelLines.length; li++) {
        ctx.fillText(labelLines[li], LABEL_W / 2, startY + li * lineH, maxLabelW);
      }

      // Items area background (slightly different from main bg for contrast)
      ctx.fillStyle = isDark ? '#1f2937' : '#f9fafb';
      ctx.fillRect(LABEL_W, y, itemsAreaW, height);

      // Draw items
      if (isCovers) {

      for (let i = 0; i < vnIds.length; i++) {
        const vn = vnMap[vnIds[i]];
        if (!vn) continue;

        const col = i % cols;
        const row = Math.floor(i / cols);
        const ix = LABEL_W + PAD + col * (itemW + GAP);
        const iy = y + PAD + row * (itemH + GAP);

          // Draw cover image
          if (vn.imageUrl) {
            const img = imageCache.get(getExportUrl(vn.imageUrl));
            if (img) {
              const isNsfw = (vn.imageSexual ?? 0) >= NSFW_THRESHOLD;
              const isRevealed = nsfwState ? nsfwState.allRevealed || nsfwState.isRevealed(vn.id) : true;
              if (isNsfw && !isRevealed) {
                drawPixelated(ctx, img, ix, iy, itemW, itemH);
              } else {
                // Draw with object-cover (center crop)
                const imgAspect = img.naturalWidth / img.naturalHeight;
                const cellAspect = itemW / itemH;
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
                  sy = (img.naturalHeight - sh) * 0.2; // Bias toward top for VN covers
                }
                ctx.drawImage(img, sx, sy, sw, sh, ix, iy, itemW, itemH);
              }
            } else {
              // Placeholder for failed image
              ctx.fillStyle = isDark ? '#374151' : '#e5e7eb';
              ctx.fillRect(ix, iy, itemW, itemH);
            }
          } else {
            // No image — draw truncated title like the page (.slice(0, 20))
            ctx.fillStyle = isDark ? '#374151' : '#e5e7eb';
            ctx.fillRect(ix, iy, itemW, itemH);
            ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280';
            ctx.font = '11px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const noImgTitle = getTitle(vn).slice(0, 20);
            const noImgLines = wrapText(ctx, noImgTitle, itemW - 4, 3);
            const noImgLineH = Math.round(11 * 1.25);
            const noImgTop = iy + (itemH - noImgLines.length * noImgLineH) / 2;
            for (let li = 0; li < noImgLines.length; li++) {
              ctx.fillText(noImgLines[li], ix + itemW / 2, noImgTop + noImgLineH * (li + 0.5), itemW - 4);
            }
          }

          // Score badge on covers
          if (showScores && vn.vote) {
            const text = String(vn.vote);
            ctx.font = `bold ${scoreFontSize}px system-ui, -apple-system, sans-serif`;
            const textW = ctx.measureText(text).width;
            const badgeW = textW + 8;
            const badgeH = Math.round(scoreFontSize * 1.6);
            const bx = ix + 3;
            const by = iy + 3;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.beginPath();
            safeRoundRect(ctx, bx, by, badgeW, badgeH, 7);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, bx + badgeW / 2, by + badgeH / 2);
          }

          // Title overlay on covers — wrap naturally, capped at 40% of cover height (matches page overflow-hidden)
          if (showTitles) {
            ctx.font = `bold ${titleFontSize}px system-ui, -apple-system, sans-serif`;
            const lineH = Math.round(titleFontSize * 1.25); // leading-tight
            const padY = 2;
            const maxBarH = Math.floor(itemH * (titleMaxH / 100));
            // Wrap with generous line limit, then only render lines that fit
            const allLines = wrapText(ctx, getTitle(vn), itemW - 4, 20);
            const fittableLines = Math.max(1, Math.floor((maxBarH - padY * 2) / lineH));
            const titleLines = allLines.slice(0, fittableLines);
            const barH = titleLines.length * lineH + padY * 2;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(ix, iy + itemH - barH, itemW, barH);
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let li = 0; li < titleLines.length; li++) {
              ctx.fillText(titleLines[li], ix + itemW / 2, iy + itemH - barH + padY + lineH * (li + 0.5), itemW - 4);
            }
          }
      }
      } else {
        // Titles mode — flow layout with variable-width badges
        const widths = badgeWidths.get(tier.id) ?? [];
        ctx.font = '12px system-ui, -apple-system, sans-serif';
        let bx = LABEL_W + PAD;
        let by = y + PAD;
        const areaRight = LABEL_W + itemsAreaW - PAD;

        for (let i = 0; i < vnIds.length; i++) {
          const vn = vnMap[vnIds[i]];
          if (!vn) continue;
          const bw = widths[i] ?? 60;

          // Wrap to next line if needed
          if (bx > LABEL_W + PAD && bx + bw > areaRight) {
            bx = LABEL_W + PAD;
            by += TITLE_H + GAP;
          }

          // Badge background
          ctx.fillStyle = isDark ? '#374151' : '#f3f4f6';
          ctx.strokeStyle = isDark ? '#4b5563' : '#d1d5db';
          ctx.lineWidth = 1;
          ctx.beginPath();
          safeRoundRect(ctx, bx, by, bw, TITLE_H, BADGE_RADIUS);
          ctx.fill();
          ctx.stroke();

          // Badge text
          const titleText = getTitle(vn);
          const labelText = showScores && vn.vote ? `${titleText} (${vn.vote})` : titleText;
          ctx.fillStyle = isDark ? '#e5e7eb' : '#374151';
          ctx.font = '12px system-ui, -apple-system, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(labelText, bx + bw / 2, by + TITLE_H / 2);

          bx += bw + GAP;
        }
      }

      // Row separator
      y += height;
      if (ri < rows.length - 1) {
        ctx.fillStyle = isDark ? '#374151' : '#e5e7eb';
        ctx.fillRect(0, y, canvasW, BORDER);
        y += BORDER;
        // Yield to main thread between rows for UI responsiveness
        await new Promise<void>(r => setTimeout(r, 0));
      }
    }

    return canvas;
  }, [tierDefs, tiers, vnMap, displayMode, showTitles, showScores, sizeConfig, listTitle, titleMaxH, exportScale, nsfwState]);

  const generateBlob = useCallback(async (format?: ExportFormat): Promise<Blob> => {
    const canvas = await renderToCanvas();
    if (!checkWebPLimits(canvas, format ?? 'png')) throw new Error('WebP size limit exceeded');
    const mimeType = format === 'webp' ? 'image/webp' : format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const quality = format && format !== 'png' ? 0.92 : undefined;
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob failed'));
      }, mimeType, quality);
    });
  }, [renderToCanvas, checkWebPLimits]);

  const exportAsImage = useCallback(async (format: ExportFormat = 'jpeg') => {
    setExporting(true);
    try {
      const canvas = await renderToCanvas();
      if (!checkWebPLimits(canvas, format)) return;
      const mimeType = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
      const quality = format === 'png' ? undefined : 0.92;
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), mimeType, quality);
      });
      const userPart = (username || 'tierlist').replace(/[^a-zA-Z0-9_-]/g, '_');
      const ext = format === 'png' ? 'png' : format === 'webp' ? 'webp' : 'jpg';
      const filename = `vn-tierlist-${userPart}-${new Date().toISOString().slice(0, 10)}.${ext}`;
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
      }, 100);
    } catch (err) {
      console.error('Tier list export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [renderToCanvas, checkWebPLimits, username]);

  return { exporting, exportAsImage, generateBlob, exportError, dismissExportError };
}
