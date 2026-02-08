'use client';

import { createContext, useContext, useState, useCallback, ReactNode, useMemo } from 'react';
import { usePathname } from 'next/navigation';

interface NSFWRevealContextType {
  isRevealed: (vnId: string) => boolean;
  revealVN: (vnId: string) => void;
  /** Changes on every route change — consumers use this to reset local state */
  pathname: string;
}

const NSFWRevealContext = createContext<NSFWRevealContextType | null>(null);

export function NSFWRevealProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Derive revealed IDs from pathname — new pathname = new empty Set
  const [revealState, setRevealState] = useState<{ pathname: string; ids: Set<string> }>({
    pathname,
    ids: new Set(),
  });

  // If pathname changed, persist the reset so old reveals don't resurface
  // on back navigation (e.g. /browse → /vn/v123 → back to /browse)
  if (revealState.pathname !== pathname) {
    setRevealState({ pathname, ids: new Set() });
  }
  const current = revealState.pathname === pathname
    ? revealState
    : { pathname, ids: new Set<string>() };

  const revealVN = useCallback((vnId: string) => {
    setRevealState(prev => {
      // If pathname changed since last state update, start with a fresh set
      const ids = prev.pathname === pathname
        ? new Set(prev.ids)
        : new Set<string>();
      ids.add(vnId);
      return { pathname, ids };
    });
  }, [pathname]);

  const isRevealed = useCallback((vnId: string) => current.ids.has(vnId), [current]);

  const value = useMemo(() => ({
    isRevealed,
    revealVN,
    pathname,
  }), [isRevealed, revealVN, pathname]);

  return (
    <NSFWRevealContext.Provider value={value}>
      {children}
    </NSFWRevealContext.Provider>
  );
}

export function useNSFWRevealContext() {
  return useContext(NSFWRevealContext);
}
