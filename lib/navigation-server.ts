// Server-only navigation utilities that require file system access
// This file should only be imported in server components

import { getGuideHeroImage } from './mdx';
import { navigation, type NavItem } from './navigation';

export interface GuideWithImage extends NavItem {
  image: string | null;
}

/**
 * Get guides with their hero images for visual showcase.
 * Images are extracted from the first image in each guide's MDX content.
 *
 * NOTE: This function reads files and must only be called server-side.
 */
export function getGuidesWithImages(): GuideWithImage[] {
  const guides = navigation.find(s => s.title === 'Guides');
  if (!guides) return [];

  return guides.items.map(guide => ({
    ...guide,
    image: getGuideHeroImage(guide.slug),
  }));
}
