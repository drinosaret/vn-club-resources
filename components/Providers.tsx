'use client';

import { ReactNode, useEffect } from 'react';
import { SWRConfig } from 'swr';
import { TitlePreferenceProvider } from '@/lib/title-preference';
import { NSFWRevealProvider } from '@/lib/nsfw-reveal';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  // Re-enable CSS transitions after hydration.
  // The inline <head> script adds .no-transitions to prevent font-flash
  // in Firefox (see globals.css). We remove it after the first paint
  // following hydration so transitions work normally from here on.
  useEffect(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('no-transitions');
    });
  }, []);

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
