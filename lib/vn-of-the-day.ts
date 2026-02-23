/**
 * Server-side fetching for VN of the Day.
 * Uses Next.js ISR for automatic revalidation.
 */

import { getBackendUrlOptional } from './config';

export interface VNOfTheDayTag {
  name: string;
  category: string | null;
}

export interface VNOfTheDayData {
  vn_id: string;
  date: string;
  is_override: boolean;
  title: string;
  title_jp: string | null;
  title_romaji: string | null;
  description: string | null;
  image_url: string | null;
  image_sexual: number | null;
  rating: number | null;
  votecount: number | null;
  released: string | null;
  developers: string[];
  tags: VNOfTheDayTag[];
  length_minutes: number | null;
}

/**
 * Fetch VN of the Day from the backend.
 * Pass a date string (YYYY-MM-DD) for a specific day, or omit for today.
 * Returns null if backend is unavailable or no pick exists.
 */
export async function getVNOfTheDay(date?: string): Promise<VNOfTheDayData | null> {
  const backendUrl = getBackendUrlOptional();
  if (!backendUrl) return null;

  try {
    const url = date
      ? `${backendUrl}/api/v1/vn-of-the-day?date=${date}`
      : `${backendUrl}/api/v1/vn-of-the-day`;
    const res = await fetch(url, {
      next: { revalidate: 300 }, // ISR: revalidate every 5 minutes
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
