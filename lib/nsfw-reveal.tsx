'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useMemo } from 'react';
import { usePathname } from 'next/navigation';

interface NSFWRevealContextType {
  isRevealed: (vnId: string) => boolean;
  revealVN: (vnId: string) => void;
  /** Changes on every route change — consumers use this to reset local state */
  pathname: string;
  /** When true, all NSFW images are shown uncensored */
  allRevealed: boolean;
  setAllRevealed: (value: boolean) => void;
}

const NSFWRevealContext = createContext<NSFWRevealContextType | null>(null);

const NSFW_UNCENSORED_KEY = 'nsfw-uncensored';

export function NSFWRevealProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [allRevealed, setAllRevealedState] = useState(false);

  // Read persisted preference on mount (avoids hydration mismatch — SSR always renders blurred)
  useEffect(() => {
    try {
      setAllRevealedState(localStorage.getItem(NSFW_UNCENSORED_KEY) === 'true');
    } catch {}
  }, []);

  const setAllRevealed = useCallback((value: boolean) => {
    setAllRevealedState(value);
    try {
      if (value) {
        localStorage.setItem(NSFW_UNCENSORED_KEY, 'true');
      } else {
        localStorage.removeItem(NSFW_UNCENSORED_KEY);
      }
    } catch {}
  }, []);

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
    allRevealed,
    setAllRevealed,
  }), [isRevealed, revealVN, pathname, allRevealed, setAllRevealed]);

  return (
    <NSFWRevealContext.Provider value={value}>
      {children}
    </NSFWRevealContext.Provider>
  );
}

export function useNSFWRevealContext() {
  return useContext(NSFWRevealContext);
}
