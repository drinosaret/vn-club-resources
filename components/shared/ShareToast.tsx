'use client';

import { useEffect } from 'react';
import { Check, X, AlertTriangle } from 'lucide-react';
import { useLocale } from '@/lib/i18n/locale-context';
import type { Locale } from '@/lib/i18n/types';

interface ShareToastProps {
  message: string | null;
  isError?: boolean;
  onDismiss: () => void;
}

/**
 * The one line this component writes itself. Every other message it shows arrives already
 * translated from the caller, and this branch is reached on the Japanese routes too.
 */
const COPY_FAILED_MANUAL: Record<Locale, string> = {
  en: 'Link created! Copy failed, select manually:',
  ja: 'リンクを作成しました。コピーできなかったので手動で選択してください:',
};

export function ShareToast({ message, isError, onDismiss }: ShareToastProps) {
  const locale = useLocale();

  useEffect(() => {
    if (!message) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [message, onDismiss]);

  if (!message) return null;

  const isUrl = message.startsWith('http');

  if (isUrl) {
    return (
      <div role="status" className="fixed bottom-6 left-4 right-4 z-[100] animate-slide-up flex justify-center">
        <div className="sw-toast on-box flex flex-col gap-2 px-4 py-3 max-w-md w-full">
          <div className="flex items-center gap-2">
            <Check className="sw-toast-mark w-4 h-4 shrink-0" />
            <span>{COPY_FAILED_MANUAL[locale]}</span>
            <button onClick={onDismiss} aria-label="Dismiss" className="sw-icon sw-icon--over ml-auto shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            readOnly
            aria-label="Shareable link"
            value={message}
            onFocus={e => e.target.select()}
            onClick={e => (e.target as HTMLInputElement).select()}
            className="sw-toast-field"
          />
        </div>
      </div>
    );
  }

  return (
    <div role={isError ? 'alert' : 'status'} className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-slide-up">
      <div className={`sw-toast on-box flex items-center gap-3 px-4 py-3 max-w-sm ${isError ? 'sw-toast--alert' : ''}`}>
        {isError
          ? <AlertTriangle className="sw-toast-mark w-4 h-4 shrink-0" />
          : <Check className="sw-toast-mark w-4 h-4 shrink-0" />
        }
        <span>{message}</span>
        <button onClick={onDismiss} aria-label="Dismiss" className="sw-icon sw-icon--over ml-auto shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
