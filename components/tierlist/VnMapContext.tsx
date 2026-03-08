'use client';

import { createContext, useContext } from 'react';
import type { TierVN } from '@/lib/tier-config';

const VnMapContext = createContext<Record<string, TierVN>>({});

export const VnMapProvider = VnMapContext.Provider;

export function useVnMap() {
  return useContext(VnMapContext);
}
