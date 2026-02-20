'use client';

import useSWR from 'swr';
import { ExternalLink } from 'lucide-react';

const fetchDeckId = async (vnId: string): Promise<number | null> => {
  const res = await fetch(`/api/jiten/${vnId}/`);
  if (!res.ok) throw new Error(`Jiten lookup failed (${res.status})`);
  const data: number[] | null = await res.json();
  return data && data.length > 0 ? data[0] : null;
};

/** Shared hook to look up the jiten.moe deck ID for a VN.
 *  Returns: undefined (loading), null (no deck), or number (deck ID). */
export function useJitenDeck(vnId: string | undefined): number | null | undefined {
  const { data: deckId } = useSWR(
    vnId ? ['jiten-deck', vnId] : null,
    () => fetchDeckId(vnId!),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      dedupingInterval: 60000,
      errorRetryCount: 2,
    }
  );
  return deckId;
}

interface JitenLinkProps {
  vnId: string;
  deckId?: number | null;
}

export default function JitenLink({ vnId, deckId: externalDeckId }: JitenLinkProps) {
  const lookedUpDeckId = useJitenDeck(externalDeckId !== undefined ? undefined : vnId);
  const deckId = externalDeckId ?? lookedUpDeckId;

  if (!deckId) return null;

  return (
    <a
      href={`https://jiten.moe/decks/media/${deckId}/detail`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors animate-fade-in"
    >
      <span><span className="hidden sm:inline">View on </span>Jiten</span>
      <ExternalLink className="w-4 h-4" />
    </a>
  );
}
