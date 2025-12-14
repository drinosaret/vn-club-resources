/**
 * Generate a consistent heading ID/slug from text.
 * This function should be used everywhere heading IDs are generated
 * to ensure TableOfContents links match rendered heading IDs.
 */
export function generateHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
}
