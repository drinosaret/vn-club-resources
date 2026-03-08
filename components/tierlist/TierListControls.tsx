'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';
import { useTierListExport } from '@/hooks/useTierListExport';
import type { ExportFormat } from '@/hooks/useTierListExport';
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
}

export function TierListControls({
  mode, tierDefs, tiers, pool, vnMap, username, displayMode, thumbnailSize, sizeConfig, vnCount, importing, showTitles, showScores, titleMaxH, listTitle,
}: TierListControlsProps) {
  const locale = useLocale();
  const s = tierListStrings[locale];
  const nsfwContext = useNSFWRevealContext();
  const nsfwExportState = useMemo(() =>
    nsfwContext ? { allRevealed: nsfwContext.allRevealed, isRevealed: nsfwContext.isRevealed } : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nsfwContext?.allRevealed, nsfwContext?.isRevealed]
  );
  const { exporting, exportAsImage, generateBlob } = useTierListExport(tierDefs, tiers, vnMap, username, displayMode, showTitles, showScores, sizeConfig, listTitle, titleMaxH, nsfwExportState);

  const buildShareData = useCallback(() => {
    let titlePreference: 'romaji' | 'japanese' = 'romaji';
    try {
      const stored = localStorage.getItem('vn-title-preference');
      if (stored === 'japanese' || stored === 'romaji') titlePreference = stored;
    } catch { /* ignore */ }

    const settings = { displayMode, thumbnailSize, showTitles, showScores, titleMaxH, titlePreference };

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
  }, [mode, tierDefs, tiers, pool, listTitle, displayMode, thumbnailSize, showTitles, showScores, titleMaxH, vnMap]);

  const getShareUrl = useCallback(async () => {
    const id = await createSharedLayout('tierlist', buildShareData());
    return `${window.location.origin}/tierlist/s/${id}/`;
  }, [buildShareData]);
  const imageShare = useImageShare({
    generateBlob,
    shareText: mode === 'characters' ? s['controls.charShareText'] : s['controls.shareText'],
    hashtags: mode === 'characters' ? s['controls.charShareHashtags'] : s['controls.shareHashtags'],
    filename: `${mode === 'characters' ? 'char' : 'vn'}-tierlist-${username || 'list'}.png`,
    getShareUrl,
    title: listTitle || undefined,
  });

  const [exportFormat, setExportFormat] = useState<ExportFormat>('jpeg');

  // Share link — cache last share to avoid creating duplicate links
  const [creatingLink, setCreatingLink] = useState(false);
  const [linkToast, setLinkToast] = useState<string | null>(null);
  const lastShareRef = useRef<{ hash: string; url: string } | null>(null);
  const handleCreateLink = useCallback(async () => {
    if (vnCount === 0) return;
    setCreatingLink(true);
    const data = buildShareData();
    const dataHash = JSON.stringify(data);

    // Reuse existing link if data hasn't changed
    if (lastShareRef.current?.hash === dataHash) {
      const url = lastShareRef.current.url;
      const result = await copyAsyncText(Promise.resolve(url)).catch(() => null);
      if (result?.copied) {
        setLinkToast('Link copied!');
        setTimeout(() => setLinkToast(null), 3000);
      } else {
        setLinkToast(url);
        setTimeout(() => setLinkToast(null), 8000);
      }
      setCreatingLink(false);
      return;
    }

    let shareError: string | null = null;
    const urlPromise = createSharedLayout('tierlist', data)
      .then(id => {
        const url = `${window.location.origin}/tierlist/s/${id}/`;
        lastShareRef.current = { hash: dataHash, url };
        return url;
      })
      .catch((err: Error) => {
        shareError = err.message;
        throw err;
      });
    const result = await copyAsyncText(urlPromise).catch(() => null);
    if (!result) {
      const msg = shareError === 'rate_limited'
        ? 'Too many requests - please wait a minute'
        : 'Failed to create link';
      setLinkToast(msg);
      setTimeout(() => setLinkToast(null), 4000);
      const { logReporter } = await import('@/lib/log-reporter');
      logReporter.error('Tierlist share creation failed', {
        component: 'TierListControls', mode, vnCount, shareError,
      });
    } else if (result.copied) {
      setLinkToast('Link copied!');
      setTimeout(() => setLinkToast(null), 3000);
    } else {
      setLinkToast(result.text);
      setTimeout(() => setLinkToast(null), 8000);
    }
    setCreatingLink(false);
  }, [buildShareData, vnCount, mode]);

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
        <select
          value={exportFormat}
          onChange={e => setExportFormat(e.target.value as ExportFormat)}
          disabled={exportDisabled}
          className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed border-l border-blue-500 rounded-r-lg px-2 cursor-pointer transition-colors appearance-none text-center"
          aria-label="Export format"
        >
          {(['jpeg', 'png', 'webp'] as const).map(f => (
            <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
          ))}
        </select>
      </div>

      <ShareToast message={imageShare.toastMessage} isError={imageShare.toastIsError} onDismiss={imageShare.dismissToast} />
      <ShareToast message={linkToast} isError={linkToast === 'Failed to create link' || linkToast === 'Too many requests - please wait a minute'} onDismiss={() => setLinkToast(null)} />
    </>
  );
}
