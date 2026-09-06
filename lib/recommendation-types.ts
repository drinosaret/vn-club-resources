/**
 * One recommendation as the endpoint returns it.
 *
 * Shared between the page and the renderers that draw it, so a component under `components/`
 * does not have to reach into a route directory for the shape of its own prop.
 */

import {
  PredictedRating,
  RecommendationReason,
} from '@/components/recommendations/RecommendationEvidence';
import type { SignalKey } from '@/lib/recommendation-weights';

export interface RecommendationDetails {
  matched_tags: Array<{ id: number; name: string; user_weight: number; vn_score: number; contribution: number; weighted_score: number; count: number }>;
  matched_staff: Array<{ id: string; name: string; name_original?: string | null; user_avg_rating: number; weight: number; weighted_score: number; count: number }>;
  matched_developers: Array<{ name: string; name_original?: string | null; user_avg_rating: number; weight: number; weighted_score: number; count: number }>;
  matched_seiyuu?: Array<{ id: string; name: string; name_original?: string | null; weighted_score: number; count: number }>;
  matched_traits?: Array<{ id: number; name: string; weighted_score: number; count: number }>;
  contributing_vns: Array<{ id: string; title: string; title_jp?: string | null; title_romaji?: string | null; similarity: number }>;
  similar_games: Array<{ source_vn_id: string; source_title?: string; source_title_jp?: string | null; source_title_romaji?: string | null; similarity: number }>;
  users_also_read: Array<{ source_vn_id: string; source_title?: string; source_title_jp?: string | null; source_title_romaji?: string | null; co_score: number; user_count: number }>;
  /** Titles the reader rated highly whose premise sits close to this one's. Empty where
   *  the signal took no part, which includes a title with no description on record. */
  description_matches?: Array<{ source_vn_id: string; source_title?: string; source_title_jp?: string | null; source_title_romaji?: string | null; similarity: number }>;
}

/** An unread direct sequel of a title the reader liked. */
export interface Continuation {
  vn_id: string;
  title: string;
  title_jp?: string | null;
  title_romaji?: string | null;
  image_url: string | null;
  image_sexual: number | null;
  rating: number | null;
  continues: {
    vn_id: string;
    title: string;
    title_jp?: string | null;
    title_romaji?: string | null;
    /** The reader's own mark for the earlier title, 0 to 10. */
    score: number;
  };
}

export interface Recommendation {
  vn_id: string;
  title: string;
  title_jp?: string;       // Original Japanese title (kanji/kana)
  title_romaji?: string;   // Romanized title
  score: number;
  /**
   * 0-100. On a signal list this is that signal's own raw score, so it says how strongly
   * the signal matched. On the combined list it is a blend of nine scores on nine scales
   * and is not shown, which is the whole reason the tabs exist.
   */
  normalized_score: number;
  match_reasons: string[];
  image_url: string | null;
  image_sexual: number | null;  // For NSFW blur (0=safe, 1=suggestive, 2=explicit)
  rating: number | null;
  /**
   * Which entities put this title on the list, named. Present on a saved page as well as a
   * computed one, which is what lets every card say why it is there.
   */
  reason?: RecommendationReason | null;
  /**
   * Rank agreement across the lists. Carried on a computed page and a saved one alike; a
   * row saved before it was stored reads as null rather than as zero agreement.
   */
  confidence?: number | null;
  /** How many lists ranked it, and where each placed it by midrank. Computed pages only. */
  signals_ranked?: number;
  ranked_in?: Record<string, number>;
  /** Absent where the prediction is switched off, and on saved rows written before it was stored. */
  predicted_rating?: PredictedRating | null;
  /**
   * Per-signal scores, 0 to 1. A signal that scored zero may be omitted rather than sent
   * as a zero, so every key is optional and a missing one reads as nothing.
   */
  scores: Partial<Record<SignalKey, number>>;
  /** Release year, where the catalogue records a date. */
  year?: number | null;
  /** VNDB length category 1 to 5, and the reported average playtime in minutes. */
  length?: number | null;
  length_minutes?: number | null;
  /** Japanese reading difficulty band, only for titles jiten has analysed. */
  difficulty?: number | null;
  details?: RecommendationDetails;  // Optional - fetched on-demand
}
