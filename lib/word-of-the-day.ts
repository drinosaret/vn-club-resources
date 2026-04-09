/**
 * Server-side fetching for Word of the Day.
 * Uses Next.js ISR for automatic revalidation.
 */

import { getBackendUrlOptional } from './config';

export interface WordDefinition {
  meanings: string[];
  pos: string[];
  misc: string[];
  field: string[];
}

export interface KanjiCompound {
  written: string;
  reading: string;
  meanings: string[];
}

export interface KanjiInfo {
  character: string;
  jlpt_level: number | null;
  grade: number | null;
  stroke_count: number | null;
  frequency: number | null;
  meanings: string[];
  kun_readings: string[];
  on_readings: string[];
  heisig_en: string | null;
  name_readings: string[];
  compounds: KanjiCompound[];
}

export interface ExampleSentence {
  text: string;
  wordPosition?: number;
  wordLength?: number;
  source_title?: string;
  source_english?: string;
  source_type?: string;
  vn_id?: string;
  vn_title?: string;
  vn_title_jp?: string;
  vn_title_romaji?: string;
}

export interface RelatedTag {
  id: number;
  name: string;
  category: string;
  relevance: number;
  word_vn_count: number;
}

export interface AlternativeReading {
  text: string;
  frequency_percentage: number | null;
  used_in_media: number | null;
  reading_index: number;
}

export interface WordOfTheDayData {
  word_id: number;
  reading_index: number;
  date: string;
  is_override: boolean;
  main_reading: { text: string };
  alternative_readings: AlternativeReading[];
  parts_of_speech: string[];
  definitions: WordDefinition[];
  example_sentences: ExampleSentence[];
  kanji_info: KanjiInfo[];
  frequency_rank: number | null;
  frequency_percentage: number | null;
  used_in_media: number | null;
  used_in_vns: number | null;
  pitch_accents: number[];
  occurrences: number | null;
  jisho: {
    jlpt: string[];
    is_common: boolean;
    tags: string[];
    sense_notes: Array<{
      tags: string[];
      info: string[];
      see_also: string[];
    }>;
  } | null;
  tatoeba_sentences: Array<{
    japanese: string;
    english: string;
  }>;
  featured_vn: {
    vn_id: string;
    title: string;
    title_jp: string | null;
    title_romaji: string | null;
    image_url: string | null;
    image_sexual: number | null;
    occurrences: number | null;
  } | null;
  related_tags: RelatedTag[];
}

export interface WordOfTheDayHistoryItem {
  word_id: number;
  date: string;
  text: string;
  meanings: string[];
  parts_of_speech: string[];
  is_override: boolean;
}

/**
 * Fetch Word of the Day from the backend.
 * Pass a date string (YYYY-MM-DD) for a specific day, or omit for today.
 */
export async function getWordOfTheDay(date?: string): Promise<WordOfTheDayData | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  try {
    const url = date
      ? `${backendUrl}/api/v1/word-of-the-day?date=${encodeURIComponent(date)}`
      : `${backendUrl}/api/v1/word-of-the-day`;
    const res = await fetch(url, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch Word of the Day history from the backend.
 */
export async function getWordOfTheDayHistory(limit: number = 14): Promise<WordOfTheDayHistoryItem[]> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return [];

  try {
    const res = await fetch(`${backendUrl}/api/v1/word-of-the-day/history?limit=${limit}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
