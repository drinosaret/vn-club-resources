'use client';

import useSWR from 'swr';
import { ExternalLink } from 'lucide-react';

interface JitenLinkProps {
  vnId: string;
}

const fetchDeckId = async (vnId: string): Promise<number | null> => {
  const res = await fetch(
    `https://api.jiten.moe/api/media-deck/by-link-id/2/${vnId}`
  );
  if (!res.ok) return null;
  const data: number[] = await res.json();
  return data.length > 0 ? data[0] : null;
};

export default function JitenLink({ vnId }: JitenLinkProps) {
  const { data: deckId } = useSWR(
    vnId ? ['jiten-deck', vnId] : null,
    () => fetchDeckId(vnId),
    { revalidateOnFocus: false }
  );

  if (!deckId) return null;

  return (
    <a
      href={`https://jiten.moe/decks/media/${deckId}/detail`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors animate-fade-in"
    >
      <span className="hidden sm:inline">View on</span> Jiten
      <ExternalLink className="w-4 h-4" />
    </a>
  );
}
