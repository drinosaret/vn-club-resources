'use client';

import { ReactNode, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { SWRConfig } from 'swr';
import { TitlePreferenceProvider } from '@/lib/title-preference';
import { NSFWRevealProvider } from '@/lib/nsfw-reveal';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const pathname = usePathname();

  // Re-enable CSS transitions after hydration.
  // The inline <head> script adds .no-transitions to prevent font-flash
  // in Firefox (see globals.css). We remove it after the first paint
  // following hydration so transitions work normally from here on.
  useEffect(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('no-transitions');
    });
  }, []);

  // Firefox rendering debug flags are session-scoped and controlled via settings menu.
  useEffect(() => {
    const root = document.documentElement;
    const DEBUG_CLASSES = [
      'ffdbg-motion',
      'ffdbg-filters',
      'ffdbg-contain-main',
      'ffdbg-contain-grid',
      'ffdbg-text',
      'ffdbg-cover-hover',
      'ffdbg-grid-fade',
      'ffdbg-nostt',
      'ffdbg-paint',
      'ffdbg-noclamp',
      'ffdbg-sysfont',
      'ffdbg-textlayer',
      'ffdbg-noclip',
      'ffdbg-gpulayer',
    ];
    root.classList.remove(...DEBUG_CLASSES);

    const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
    if (!isFirefox) return;

    const raw = (sessionStorage.getItem('ffdbg') || '').toLowerCase();

    if (!raw) return;

    const flags = raw.split(',').map(s => s.trim()).filter(Boolean);
    for (const flag of flags) {
      const cls = `ffdbg-${flag}`;
      if (DEBUG_CLASSES.includes(cls)) root.classList.add(cls);
    }
  }, [pathname]);

  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        dedupingInterval: 30000,
        keepPreviousData: true,
      }}
    >
      <TitlePreferenceProvider>
        <NSFWRevealProvider>
          {children}
        </NSFWRevealProvider>
      </TitlePreferenceProvider>
    </SWRConfig>
  );
}
