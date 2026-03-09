'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, ImageIcon, Loader2 } from 'lucide-react';
import { useLocale } from '@/lib/i18n/locale-context';
import { sharedStrings } from '@/lib/i18n/translations/shared';
import { NSFW_THRESHOLD } from '@/lib/nsfw-reveal';

interface ReleaseCover {
  id: string;
  title: string;
  imageUrl: string;
  imageSexual: number;
}

interface CoverPickerProps {
  vnId: string;
  currentImageUrl: string | null;
  originalImageUrl: string | null;
  originalImageSexual?: number;
  onSelect: (imageUrl: string, imageSexual: number) => void;
}

export function CoverPicker({ vnId, currentImageUrl, originalImageUrl, originalImageSexual, onSelect }: CoverPickerProps) {
  const locale = useLocale();
  const s = sharedStrings[locale];
  const [expanded, setExpanded] = useState(false);
  const [covers, setCovers] = useState<ReleaseCover[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Reset state when vnId changes
  useEffect(() => {
    setCovers(null);
    setError(false);
    setExpanded(false);
  }, [vnId]);

  // Abort in-flight fetch on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const fetchCovers = useCallback(async () => {
    if (covers !== null || loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/vndb-releases?vnId=${encodeURIComponent(vnId)}`, { signal: controller.signal });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCovers(data.covers ?? []);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [vnId, covers, loading]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) fetchCovers();
  };

  // Build full list: original cover first (if not already in release covers), then release covers
  const allCovers = (() => {
    if (!covers) return null;
    const list = [...covers];
    if (originalImageUrl) {
      const origPath = originalImageUrl.split('?')[0];
      const alreadyIncluded = list.some(c => c.imageUrl.split('?')[0] === origPath);
      if (!alreadyIncluded) {
        list.unshift({ id: 'original', title: s['cover.original'], imageUrl: originalImageUrl, imageSexual: originalImageSexual ?? 0 });
      }
    }
    return list;
  })();

  const hasCovers = allCovers && allCovers.length > 1;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        <ImageIcon className="w-3.5 h-3.5" />
        <span>{s['cover.changeCover']}</span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="mt-2">
          {loading && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {s['cover.loading']}
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 py-1">{s['cover.error']}</p>
          )}

          {!loading && !error && covers !== null && !hasCovers && (
            <p className="text-xs text-gray-400 py-1">{s['cover.noAlts']}</p>
          )}

          {!loading && hasCovers && (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {allCovers.map(cover => {
                const isSelected = currentImageUrl?.split('?')[0] === cover.imageUrl.split('?')[0];
                const isNsfw = (cover.imageSexual ?? 0) >= NSFW_THRESHOLD;
                return (
                  <button
                    key={cover.imageUrl}
                    type="button"
                    onClick={() => onSelect(cover.imageUrl, cover.imageSexual)}
                    className={`relative shrink-0 w-[48px] h-[72px] rounded overflow-hidden border-2 bg-gray-200 dark:bg-gray-700 transition-colors ${
                      isSelected
                        ? 'border-blue-500'
                        : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                    title={cover.title}
                  >
                    <img
                      src={`${cover.imageUrl}${cover.imageUrl.includes('?') ? '&' : '?'}w=128`}
                      alt=""
                      className={`w-full h-full object-cover ${isNsfw ? 'blur-md' : ''}`}
                      loading="lazy"
                    />
                    {isNsfw && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[10px] text-white/80 bg-black/40 px-1 rounded">NSFW</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
