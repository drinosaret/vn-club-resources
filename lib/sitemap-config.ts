/**
 * Shared sitemap constants used by both the sitemap generator and sitemap index route.
 */

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://vnclub.org';
export const URLS_PER_SITEMAP = 50000;

// ID ranges for sitemap chunks — keeps generateSitemaps() and sitemap() in sync
export const VN_BASE_ID = 1000;
export const CHAR_BASE_ID = 2000;
export const TAG_BASE_ID = 3000;
export const TRAIT_BASE_ID = 4000;
export const STAFF_BASE_ID = 5000;
export const SEIYUU_BASE_ID = 6000;
export const PRODUCER_BASE_ID = 7000;
