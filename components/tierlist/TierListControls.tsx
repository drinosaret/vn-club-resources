'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';
import { useTierListExport } from '@/hooks/useTierListExport';
import type { ExportFormat, ExportScale } from '@/hooks/useTierListExport';
import { useImageShare } from '@/hooks/useImageShare';
import { ShareMenu } from '@/components/shared/ShareMenu';
import { ShareToast } from '@/components/shared/ShareToast';
import { useNSFWRevealContext } from '@/lib/nsfw-reveal';
import { createSharedLayout, copyAsyncText } from '@/lib/shared-layout-api';
import type { TierDef, TierVN, TierListMode, SizeConfig, ThumbnailSize } from '@/lib/tier-config';

interface TierListControlsProps {
  mode: TierListMode;
  tierDefs: TierDef[];
  tiers: Record<string, string[]>;
  vnMap: Record<string, TierVN>;
  username: string;
  displayMode: string;
  thumbnailSize: ThumbnailSize;
  sizeConfig: SizeConfig;
  pool: string[];
  vnCount: number;
  importing?: boolean;
  showTitles: boolean;
  showScores: boolean;
  titleMaxH: number;
  listTitle: string;
  cropSquare: boolean;
}

export function TierListControls({
  mode, tierDefs, tiers, pool, vnMap, username, displayMode, thumbnailSize, sizeConfig, vnCount, importing, showTitles, showScores, titleMaxH, listTitle, cropSquare,
}: TierListControlsProps) {
  const locale = useLocale();
  const s = tierListStrings[locale];
  const nsfwContext = useNSFWRevealContext();
  const nsfwExportState = useMemo(() =>
    nsfwContext ? { allRevealed: nsfwContext.allRevealed, isRevealed: nsfwContext.isRevealed } : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nsfwContext?.allRevealed, nsfwContext?.isRevealed]
  );
  const [exportScale, setExportScale] = useState<ExportScale>(2);
  const { exporting, exportAsImage, generateBlob, exportError, dismissExportError } = useTierListExport(tierDefs, tiers, vnMap, username, displayMode, showTitles, showScores, sizeConfig, listTitle, titleMaxH, exportScale, nsfwExportState);

  const buildShareData = useCallback(() => {
    let titlePreference: 'romaji' | 'japanese' = 'romaji';
    try {
      const stored = localStorage.getItem('vn-title-preference');
      if (stored === 'japanese' || stored === 'romaji') titlePreference = stored;
    } catch { /* ignore */ }

    const settings = { displayMode, thumbnailSize, showTitles, showScores, titleMaxH, cropSquare, titlePreference };

    const overrides: Record<string, Record<string, unknown>> = {};
    for (const [id, vn] of Object.entries(vnMap)) {
      const o: Record<string, unknown> = {};
      if (vn.customTitle) o.customTitle = vn.customTitle;
      if (vn.imageUrl && vn.defaultImageUrl && vn.imageUrl !== vn.defaultImageUrl) {
        o.imageUrl = vn.imageUrl;
        if (vn.imageSexual != null) o.imageSexual = vn.imageSexual;
      }
      if (vn.vote != null) o.vote = vn.vote;
      if (Object.keys(o).length > 0) overrides[id] = o;
    }

    const shareData: Record<string, unknown> = {
      mode,
      tierDefs: tierDefs.map(({ id, label, color, textColor }) => ({ id, label, color, textColor })),
      tiers, pool, listTitle, settings,
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    };
    return shareData;
  }, [mode, tierDefs, tiers, pool, listTitle, displayMode, thumbnailSize, showTitles, showScores, titleMaxH, cropSquare, vnMap]);

  // Cached share URL — reuses existing link if data hasn't changed
  const lastShareRef = useRef<{ hash: string; url: string } | null>(null);
  const getShareUrl = useCallback(async () => {
    const data = buildShareData();
    const dataHash = JSON.stringify(data);
    if (lastShareRef.current?.hash === dataHash) return lastShareRef.current.url;
    const id = await createSharedLayout('tierlist', data);
    const url = `${window.location.origin}/tierlist/s/${id}/`;
    lastShareRef.current = { hash: dataHash, url };
    return url;
  }, [buildShareData]);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('jpeg');

  const imageShare = useImageShare({
    generateBlob,
    shareText: mode === 'characters' ? s['controls.charShareText'] : s['controls.shareText'],
    hashtags: mode === 'characters' ? s['controls.charShareHashtags'] : s['controls.shareHashtags'],
    filename: `${mode === 'characters' ? 'char' : 'vn'}-tierlist-${username || 'list'}.png`,
    getShareUrl,
    title: listTitle || undefined,
    exportFormat,
  });

  // Share link — "Copy Link" button handler
  const [creatingLink, setCreatingLink] = useState(false);
  const [linkToast, setLinkToast] = useState<string | null>(null);
  const [linkToastIsError, setLinkToastIsError] = useState(false);
  const showLinkToast = useCallback((msg: string, duration: number, isError = false) => {
    setLinkToast(msg);
    setLinkToastIsError(isError);
    setTimeout(() => setLinkToast(null), duration);
  }, []);
  const handleCreateLink = useCallback(async () => {
    if (vnCount === 0) return;
    setCreatingLink(true);

    let shareError: string | null = null;
    const urlPromise = getShareUrl().catch((err: Error) => {
      shareError = err.message;
      throw err;
    });
    const result = await copyAsyncText(urlPromise).catch(() => null);
    if (!result) {
      const msg = shareError === 'rate_limited'
        ? s['controls.rateLimited']
        : s['controls.createFailed'];
      showLinkToast(msg, 4000, true);
      const { logReporter } = await import('@/lib/log-reporter');
      logReporter.error('Tierlist share creation failed', {
        component: 'TierListControls', mode, vnCount, shareError,
      });
    } else if (result.copied) {
      showLinkToast(s['controls.linkCopied'], 3000);
    } else {
      showLinkToast(result.text, 8000);
    }
    setCreatingLink(false);
  }, [getShareUrl, vnCount, mode, s, showLinkToast]);

  const FORMAT_LABELS: Record<ExportFormat, string> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP' };
  const exportDisabled = exporting || vnCount === 0 || !!importing;

  return (
    <>
      <ShareMenu
        onShare={imageShare.share}
        sharing={imageShare.sharing}
        canNativeShare={imageShare.canNativeShare}
        disabled={vnCount === 0 || !!importing}
        onCreateLink={handleCreateLink}
        creatingLink={creatingLink}
        onOpen={imageShare.prepareBlob}
      />
      <div className="inline-flex items-stretch">
        <button
          onClick={() => exportAsImage(exportFormat)}
          disabled={exportDisabled}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-l-lg transition-colors"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{s['controls.export']}</span>
        </button>
        <button
          onClick={() => setExportScale(exportScale === 1 ? 1.5 : exportScale === 1.5 ? 2 : 1)}
          disabled={exportDisabled}
          className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed border-l border-blue-500 px-2 cursor-pointer transition-colors"
          title={s['controls.exportScale']}
        >
          {exportScale}x
        </button>
        <button
          onClick={() => setExportFormat(exportFormat === 'jpeg' ? 'png' : exportFormat === 'png' ? 'webp' : 'jpeg')}
          disabled={exportDisabled}
          className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed border-l border-blue-500 rounded-r-lg px-2 cursor-pointer transition-colors"
          title="Export format"
        >
          {FORMAT_LABELS[exportFormat]}
        </button>
      </div>

      <ShareToast message={imageShare.toastMessage} isError={imageShare.toastIsError} onDismiss={imageShare.dismissToast} />
      <ShareToast message={linkToast} isError={linkToastIsError} onDismiss={() => setLinkToast(null)} />
      <ShareToast message={exportError} isError onDismiss={dismissExportError} />
    </>
  );
}
