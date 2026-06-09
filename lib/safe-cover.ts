/**
 * Home-page cover safety. Covers on the home page are held to a stricter NSFW bar
 * than the rest of the site: at or above HOMEPAGE_COVER_THRESHOLD we don't show the
 * raw VNDB cover. We prefer swapping in jiten.moe's always-SFW cover (mirrors
 * hikaru's resolve_display_cover / COVER_BLUR_THRESHOLD); when the VN isn't on jiten
 * we keep the VNDB cover but raise its score so the existing NSFW blur kicks in.
 *
 * Server-side: resolveDeckId fetches jiten and caches the mapping in-process (24h),
 * so a given pick costs at most one jiten lookup per day.
 */
import { resolveDeckId } from '@/app/api/jiten/resolve-deck';

export const HOMEPAGE_COVER_THRESHOLD = 0.7; // matches hikaru COVER_BLUR_THRESHOLD

// Floor that guarantees a blur downstream. Keep in sync with NSFW_THRESHOLD in
// components/NSFWImage.tsx (the blur bar there is 1.5).
const FORCE_BLUR_SCORE = 1.5;

export interface HomeCover {
  imageUrl: string | null;
  imageSexual: number;
}

/**
 * Resolve the cover a home-page VN should display. Below the threshold the cover is
 * returned unchanged. At or above it: the jiten SFW cover (with a cleared score) when
 * the VN is on jiten, otherwise the original cover with a score that keeps it blurred.
 */
export async function safeHomepageCover(
  vnId: string | null | undefined,
  imageUrl: string | null | undefined,
  imageSexual: number | null | undefined,
): Promise<HomeCover> {
  const sexual = imageSexual ?? 0;
  if (sexual < HOMEPAGE_COVER_THRESHOLD || !vnId) {
    return { imageUrl: imageUrl ?? null, imageSexual: sexual };
  }
  try {
    const deckId = await resolveDeckId(vnId);
    if (deckId) {
      return { imageUrl: `https://cdn.jiten.moe/${deckId}/cover.jpg`, imageSexual: 0 };
    }
  } catch {
    // jiten unreachable: fall through to the blur
  }
  return { imageUrl: imageUrl ?? null, imageSexual: Math.max(sexual, FORCE_BLUR_SCORE) };
}
