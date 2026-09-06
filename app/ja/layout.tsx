'use client';

import { useEffect } from 'react';

import { LocaleProvider } from '@/lib/i18n/locale-context';

/**
 * The document element is declared English by the root layout, which the router gives no
 * per-route hook to override. These routes are Japanese throughout, so the declaration is
 * corrected once they are mounted and restored when navigation leaves them.
 */
export default function JaLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.lang;
    root.lang = 'ja';
    return () => {
      root.lang = previous;
    };
  }, []);

  return (
    <LocaleProvider locale="ja">
      <div lang="ja">
        {children}
      </div>
    </LocaleProvider>
  );
}
