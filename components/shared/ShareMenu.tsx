'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Share2, Copy, Link2, Loader2, Smartphone, ExternalLink } from 'lucide-react';
import { useLocale } from '@/lib/i18n/locale-context';
import { sharedStrings } from '@/lib/i18n/translations/shared';

export type SharePlatform = 'native' | 'twitter' | 'reddit' | 'clipboard' | 'open-tab';

interface ShareMenuProps {
  onShare: (platform: SharePlatform) => Promise<void>;
  sharing: boolean;
  canNativeShare: boolean;
  disabled?: boolean;
  onCreateLink?: () => Promise<void>;
  creatingLink?: boolean;
  onOpen?: () => void;
  hidePlatforms?: SharePlatform[];
  clipboardLabel?: string;
  platformSubtitle?: string;
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function RedditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  );
}

export function ShareMenu({ onShare, sharing, canNativeShare, disabled = false, onCreateLink, creatingLink = false, onOpen, hidePlatforms = [], clipboardLabel, platformSubtitle }: ShareMenuProps) {
  const locale = useLocale();
  const s = sharedStrings[locale];
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Close on Escape, scroll, or resize
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    const close = () => setIsOpen(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
    };
  }, [isOpen]);

  // Position the menu (useLayoutEffect to avoid flash)
  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuW = 224; // w-56
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuW - 8));
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 200) {
      setMenuStyle({ position: 'fixed', left, bottom: window.innerHeight - rect.top + 4 });
    } else {
      setMenuStyle({ position: 'fixed', left, top: rect.bottom + 4 });
    }
  }, [isOpen]);

  const handleAction = useCallback(async (platform: SharePlatform) => {
    setIsOpen(false);
    await onShare(platform);
  }, [onShare]);

  const handleLink = useCallback(async () => {
    setIsOpen(false);
    await onCreateLink?.();
  }, [onCreateLink]);

  const itemClass = 'w-full px-3 py-2.5 text-left text-sm flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors';

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => { const opening = !isOpen; setIsOpen(opening); if (opening) onOpen?.(); }}
        disabled={disabled || sharing}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
      >
        {sharing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
        <span className="hidden sm:inline">{s['share.share']}</span>
      </button>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          role="menu"
          className="z-50 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl py-1 animate-slide-down"
        >
          {onCreateLink && (
            <button role="menuitem" onClick={handleLink} disabled={creatingLink} className={itemClass}>
              {creatingLink ? <Loader2 className="w-4 h-4 text-gray-500 animate-spin" /> : <Link2 className="w-4 h-4 text-gray-500" />}
              <div>
                <div>{s['share.copyLink']}</div>
                <div className="text-xs text-gray-400">{s['share.copyLinkDesc']}</div>
              </div>
            </button>
          )}

          {!hidePlatforms.includes('open-tab') && (
            <button role="menuitem" onClick={() => handleAction('open-tab')} className={itemClass}>
              <ExternalLink className="w-4 h-4 text-gray-500" />
              <span>{s['share.openInTab']}</span>
            </button>
          )}

          {!hidePlatforms.includes('clipboard') && (
            <button role="menuitem" onClick={() => handleAction('clipboard')} className={`${itemClass} hidden sm:flex`}>
              <Copy className="w-4 h-4 text-gray-500" />
              <span>{clipboardLabel || s['share.copyToClipboard']}</span>
            </button>
          )}

          {(onCreateLink || !hidePlatforms.includes('open-tab') || !hidePlatforms.includes('clipboard')) && (
            <div className={`border-t border-gray-100 dark:border-gray-700 my-1 ${!onCreateLink && hidePlatforms.includes('open-tab') ? 'hidden sm:block' : ''}`} />
          )}

          <button role="menuitem" onClick={() => handleAction('twitter')} className={itemClass}>
            <XIcon className="w-4 h-4 text-gray-500" />
            <div>
              <div>{s['share.toX']}</div>
              <div className="text-xs text-gray-400">{platformSubtitle || s['share.copiesAndOpens']}</div>
            </div>
          </button>

          <button role="menuitem" onClick={() => handleAction('reddit')} className={itemClass}>
            <RedditIcon className="w-4 h-4 text-gray-500" />
            <div>
              <div>{s['share.toReddit']}</div>
              <div className="text-xs text-gray-400">{platformSubtitle || s['share.copiesAndOpens']}</div>
            </div>
          </button>

          {canNativeShare && (
            <>
              <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
              <button role="menuitem" onClick={() => handleAction('native')} className={itemClass}>
                <Smartphone className="w-4 h-4 text-gray-500" />
                <span>{s['share.viaDevice']}</span>
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
