'use client';

import { useEffect } from 'react';
import { Check, X, AlertTriangle } from 'lucide-react';

interface ShareToastProps {
  message: string | null;
  isError?: boolean;
  onDismiss: () => void;
}

export function ShareToast({ message, isError, onDismiss }: ShareToastProps) {
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
        <div className="flex flex-col gap-2 px-4 py-3 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 shadow-2xl text-sm font-medium max-w-md w-full">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400 dark:text-green-600 shrink-0" />
            <span>Link created! Copy failed — select manually:</span>
            <button onClick={onDismiss} aria-label="Dismiss" className="ml-auto shrink-0 hover:opacity-70">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            readOnly
            aria-label="Shareable link"
            value={message}
            onFocus={e => e.target.select()}
            onClick={e => (e.target as HTMLInputElement).select()}
            className="bg-white/10 dark:bg-black/10 text-inherit text-xs font-mono w-full px-2 py-1.5 rounded outline-none"
          />
        </div>
      </div>
    );
  }

  return (
    <div role={isError ? 'alert' : 'status'} className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-slide-up">
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 shadow-2xl text-sm font-medium max-w-sm">
        {isError
          ? <AlertTriangle className="w-4 h-4 text-amber-400 dark:text-amber-600 shrink-0" />
          : <Check className="w-4 h-4 text-green-400 dark:text-green-600 shrink-0" />
        }
        <span>{message}</span>
        <button onClick={onDismiss} aria-label="Dismiss" className="ml-auto shrink-0 hover:opacity-70">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
