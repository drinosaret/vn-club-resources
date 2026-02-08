/**
 * URL helpers for generating browse page links with filters.
 *
 * These helpers construct URLs that link to the internal /browse page with
 * specific filters applied (length, score, age rating, release year).
 *
 * Used by stat charts to make bars clickable, linking to the
 * corresponding filtered view on the browse page.
 */

export type EntityType = 'tag' | 'trait' | 'staff' | 'seiyuu' | 'developer' | 'publisher' | 'producer';

/**
 * Build base URLSearchParams with entity filter.
 * Sets parameters to match stats page behavior:
 * - olang empty to search all languages
 * - devstatus=-1 to include all dev statuses (not just finished)
 * - nsfw=true to include adult content
 * - spoiler_level=0 (default) to hide spoilers
 */
function buildEntityParams(entityType: EntityType, entityId: string, entityName?: string): URLSearchParams {
  const params = new URLSearchParams();

  // Strip prefix (g for tags, i for traits) and add appropriate param
  if (entityType === 'tag') {
    params.set('tags', entityId.replace(/^g/, ''));
    // Include child tags to match stats page counts (which use recursive tag tree)
    params.set('include_children', 'true');
  } else if (entityType === 'trait') {
    params.set('traits', entityId.replace(/^i/, ''));
  } else if (entityType === 'developer' || entityType === 'publisher' || entityType === 'producer') {
    // Producer pages show stats for VNs where producer is developer OR publisher.
    // Use the 'producer' param which does OR logic in the browse API.
    params.set('producer', entityId);
  } else {
    // Staff, seiyuu — set the entity filter param
    params.set(entityType, entityId);
  }

  // Default to Japanese-original VNs
  params.set('olang', 'ja');

  // Include all dev statuses to match stats (browse defaults to finished only)
  params.set('devstatus', '-1');

  // Include adult content to match stats (browse defaults to SFW only)
  params.set('nsfw', 'true');

  // Hide spoilers by default (spoiler_level=0 is the browse page default, so no need to set)

  return params;
}

/**
 * Length category mapping to browse page values.
 */
const LENGTH_KEYS: Record<string, string> = {
  very_short: 'very_short',
  short: 'short',
  medium: 'medium',
  long: 'long',
  very_long: 'very_long',
};

/**
 * Generate browse URL for a length category filter.
 * Example: Length = Very Long → /browse?tags=324&length=very_long
 */
export function getLengthFilterUrl(
  entityType: EntityType,
  entityId: string,
  lengthKey: string,
  entityName?: string
): string {
  const lengthValue = LENGTH_KEYS[lengthKey];
  if (!lengthValue) return `/browse`;

  const params = buildEntityParams(entityType, entityId, entityName);
  params.set('length', lengthValue);

  return `/browse?${params.toString()}`;
}

/**
 * Generate browse URL for a score/rating range filter.
 * Example: Score 8 → /browse?tags=324&min_rating=8&max_rating=9
 */
export function getScoreFilterUrl(
  entityType: EntityType,
  entityId: string,
  score: number,
  entityName?: string
): string {
  if (score < 1 || score > 10) return `/browse`;

  const params = buildEntityParams(entityType, entityId, entityName);
  params.set('min_rating', String(score));
  // For score 10, don't set max (or set to 10)
  if (score < 10) {
    params.set('max_rating', String(score + 1));
  }

  return `/browse?${params.toString()}`;
}

/**
 * Age rating mapping to browse page values.
 */
const AGE_RATING_KEYS: Record<string, string> = {
  all_ages: 'all_ages',
  teen: 'teen',
  adult: 'adult',
};

/**
 * Generate browse URL for an age rating filter.
 * Example: Adult → /browse?tags=324&minage=adult
 */
export function getAgeRatingFilterUrl(
  entityType: EntityType,
  entityId: string,
  ageKey: string,
  entityName?: string
): string {
  const ageValue = AGE_RATING_KEYS[ageKey];
  if (!ageValue) return `/browse`;

  const params = buildEntityParams(entityType, entityId, entityName);
  params.set('minage', ageValue);

  return `/browse?${params.toString()}`;
}

/**
 * Generate browse URL for a release year filter.
 * Example: Year 2020 → /browse?tags=324&year_min=2020&year_max=2020
 */
export function getReleaseYearFilterUrl(
  entityType: EntityType,
  entityId: string,
  year: number,
  entityName?: string
): string {
  const params = buildEntityParams(entityType, entityId, entityName);
  params.set('year_min', String(year));
  params.set('year_max', String(year));

  return `/browse?${params.toString()}`;
}
