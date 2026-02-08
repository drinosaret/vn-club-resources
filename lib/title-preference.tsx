'use client';

import { createContext, useContext, useState, useEffect, useLayoutEffect, ReactNode } from 'react';

// useLayoutEffect on client (runs before paint), useEffect on server (avoids SSR warning)
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export type TitlePreference = 'japanese' | 'romaji';

interface TitlePreferenceContextType {
  preference: TitlePreference;
  setPreference: (pref: TitlePreference) => void;
}

const TitlePreferenceContext = createContext<TitlePreferenceContextType | null>(null);

const STORAGE_KEY = 'vn-title-preference';

export function TitlePreferenceProvider({ children }: { children: ReactNode }) {
  // Start with server-safe default to avoid hydration mismatch.
  // Real preference is read from localStorage in useLayoutEffect (before paint).
  const [preference, setPreferenceState] = useState<TitlePreference>('romaji');

  useIsomorphicLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'japanese' || stored === 'romaji') {
        setPreferenceState(stored);
      } else if (stored === 'english') {
        // Migrate old 'english' preference to 'romaji'
        localStorage.setItem(STORAGE_KEY, 'romaji');
      }
    } catch {
      // localStorage not available (private browsing, etc.)
    }
  }, []);

  const setPreference = (pref: TitlePreference) => {
    setPreferenceState(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // localStorage not available - preference will only persist for session
    }
  };

  // Always render with provider to maintain context subscription
  return (
    <TitlePreferenceContext.Provider value={{ preference, setPreference }}>
      {children}
    </TitlePreferenceContext.Provider>
  );
}

export function useTitlePreference(): TitlePreferenceContextType {
  const context = useContext(TitlePreferenceContext);
  if (!context) {
    // Return default if not in provider (for SSR or components outside provider)
    return { preference: 'romaji', setPreference: () => {} };
  }
  return context;
}

/**
 * Check if a string contains Japanese characters (hiragana, katakana, or kanji).
 */
function hasJapanese(text: string): boolean {
  if (!text) return false;
  // Match hiragana, katakana, or kanji
  return /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(text);
}

/**
 * Check if a string is romanized (Latin characters only, no Japanese).
 * Returns false if the string contains any Japanese characters.
 */
function isRomanized(text: string): boolean {
  if (!text) return false;
  // If it contains any Japanese characters, it's not a clean romanized title
  if (hasJapanese(text)) return false;
  // Must have at least some Latin characters
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  return latinChars > 0;
}

/**
 * Clean a title string by removing newlines and extra whitespace.
 * Handles both actual newlines and escaped newline sequences.
 */
function cleanTitle(text: string | undefined): string {
  if (!text) return '';
  return text
    .split(/\\n|\n|\r/).join(' ')  // Split on escaped \n or actual newlines, join with space
    .replace(/\s+/g, ' ')           // Collapse multiple spaces
    .trim();
}

/**
 * Get the appropriate display title based on user preference.
 * Falls back through available titles in priority order.
 *
 * Title fields:
 * - title: Main/display title (typically romanized for Japanese VNs)
 * - title_jp: Japanese title (kanji/kana)
 * - title_romaji: Romanized Japanese title (optional, only from backend VN details)
 */
export function getDisplayTitle(
  vn: {
    title?: string;
    title_jp?: string;
    title_romaji?: string;
  },
  preference: TitlePreference
): string {
  // Clean title fields to handle newlines/whitespace
  const cleanTitleMain = cleanTitle(vn.title);
  const cleanTitleJp = cleanTitle(vn.title_jp);
  const cleanTitleRomaji = cleanTitle(vn.title_romaji);

  switch (preference) {
    case 'japanese':
      // Only use title_jp if it actually contains Japanese characters
      if (cleanTitleJp && hasJapanese(cleanTitleJp)) {
        return cleanTitleJp;
      }
      // Fall back to main title if it has Japanese
      if (cleanTitleMain && hasJapanese(cleanTitleMain)) {
        return cleanTitleMain;
      }
      // Last resort: any available title
      return cleanTitleJp || cleanTitleMain || '';

    case 'romaji':
      // Prefer main title if it's romanized (most common case)
      if (cleanTitleMain && isRomanized(cleanTitleMain)) {
        return cleanTitleMain;
      }
      // Try title_romaji as fallback (for VNs with Japanese main title)
      if (cleanTitleRomaji && isRomanized(cleanTitleRomaji)) {
        return cleanTitleRomaji;
      }
      // Last resort: any available title
      return cleanTitleMain || cleanTitleRomaji || cleanTitleJp || '';
  }
}

/**
 * Get the appropriate display name for an entity (staff, producer, etc.)
 * based on user preference. For romaji mode, prefer the `original` field
 * (romanized name) if available; otherwise fall back to `name`.
 */
export function getEntityDisplayName(
  entity: { name: string; original?: string | null },
  preference: TitlePreference
): string {
  if (preference === 'romaji' && entity.original) return entity.original;
  return entity.name;
}

/**
 * Hook that returns the display title getter function bound to current preference.
 */
export function useDisplayTitle() {
  const { preference } = useTitlePreference();

  return (vn: { title?: string; title_jp?: string; title_romaji?: string }) =>
    getDisplayTitle(vn, preference);
}
