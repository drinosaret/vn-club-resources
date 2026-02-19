import useSWR, { preload } from 'swr';

const jitenFetcher = async (url: string) => {
  const res = await fetch(url);
  if (res.status >= 500) throw new Error(`Jiten fetch failed (${res.status})`);
  if (!res.ok) return null;
  const json = await res.json();
  return json?.data ?? json;
};

const JITEN_SWR_OPTS = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  revalidateIfStale: false,
  dedupingInterval: 60000,
  errorRetryCount: 2,
} as const;

export function useJitenDetail(vnId: string | null) {
  return useSWR(
    vnId ? `/api/jiten/${vnId}/detail/` : null,
    jitenFetcher,
    JITEN_SWR_OPTS,
  );
}

export function useJitenDifficulty(vnId: string | null) {
  return useSWR(
    vnId ? `/api/jiten/${vnId}/difficulty/` : null,
    jitenFetcher,
    JITEN_SWR_OPTS,
  );
}

export interface JitenDeckDto {
  characterCount: number;
  wordCount: number;
  uniqueWordCount: number;
  uniqueWordUsedOnceCount: number;
  uniqueKanjiCount: number;
  uniqueKanjiUsedOnceCount: number;
  difficulty: number;
  difficultyRaw: number;
  sentenceCount: number;
  averageSentenceLength: number;
  dialoguePercentage: number;
  hideDialoguePercentage?: boolean;
}

export interface JitenDetailResponse {
  parentDeck: JitenDeckDto | null;
  mainDeck: JitenDeckDto | null;
  subDecks: JitenDeckDto[] | null;
}

export interface JitenDifficultyResponse {
  difficulty: number;
  peak: number;
  deciles: Record<string, number>;
  progression: Array<{ segment: number; difficulty: number; peak: number }>;
}

export interface JitenCoveragePoint {
  rank: number;
  coverage: number;
}

export interface JitenAllResponse {
  detail: JitenDetailResponse | null;
  difficulty: JitenDifficultyResponse | null;
  coverage: JitenCoveragePoint[] | null;
}

export function useJitenAll(vnId: string | null) {
  return useSWR<JitenAllResponse | null>(
    vnId ? `/api/jiten/${vnId}/all/` : null,
    jitenFetcher,
    JITEN_SWR_OPTS,
  );
}

export function useJitenSimilarDifficulty(
  vnId: string | null,
  difficultyRaw: number | null | undefined,
) {
  return useSWR(
    vnId && difficultyRaw != null
      ? `/api/jiten/similar-difficulty/?difficulty=${difficultyRaw}&exclude=${vnId}`
      : null,
    jitenFetcher,
    JITEN_SWR_OPTS,
  );
}

export function useJitenSimilarLength(
  vnId: string | null,
  characterCount: number | null | undefined,
) {
  return useSWR(
    vnId && characterCount != null
      ? `/api/jiten/similar-length/?characterCount=${characterCount}&exclude=${vnId}`
      : null,
    jitenFetcher,
    JITEN_SWR_OPTS,
  );
}

export function prefetchJitenData(vnId: string) {
  preload(`/api/jiten/${vnId}/all/`, jitenFetcher);
}
