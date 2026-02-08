'use client';

import { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { TitlePreferenceProvider } from '@/lib/title-preference';
import { NSFWRevealProvider } from '@/lib/nsfw-reveal';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
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
