'use client';

import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import type { WordOfTheDayData } from '@/lib/word-of-the-day';

type FeaturedVN = NonNullable<WordOfTheDayData['featured_vn']>;

export function WotdFeaturedVN({ vn }: { vn: FeaturedVN }) {
  const { preference } = useTitlePreference();

  const displayTitle = getDisplayTitle(
    { title: vn.title, title_jp: vn.title_jp ?? undefined, title_romaji: vn.title_romaji ?? undefined },
    preference,
  );

  const imgSrc = vn.image_url
    ? (getProxiedImageUrl(vn.image_url, { width: 256, vnId: vn.vn_id ? `v${vn.vn_id}` : undefined }) || vn.image_url)
    : null;

  const coverImage = imgSrc && (
    <NSFWImage
      src={imgSrc}
      alt={vn.title}
      imageSexual={vn.image_sexual}
      vnId={vn.vn_id ? `v${vn.vn_id}` : undefined}
      className="w-full h-full object-cover"
      compact
    />
  );

  const Wrapper = vn.vn_id ? Link : 'div';
  const wrapperProps = vn.vn_id ? { href: `/vn/${vn.vn_id}/` } : {};

  return (
    <Wrapper
      {...wrapperProps as any}
      className="wd-vn self-start w-full md:w-auto"
    >
      {/* Mobile: horizontal compact row */}
      <div className="flex md:hidden items-center gap-3 p-3">
        {coverImage && (
          <div className="wd-vn-art w-12 h-16">
            {coverImage}
          </div>
        )}
        <div className="min-w-0">
          <p className="fig-label">Most found in</p>
          <p className="wd-vn-name mt-1 line-clamp-2">
            {displayTitle}
          </p>
          {vn.occurrences != null && (
            <p className="wd-vn-meta">
              {vn.occurrences.toLocaleString()} occurrences
            </p>
          )}
        </div>
      </div>

      {/* Desktop: vertical column */}
      <div className="hidden md:flex w-48 min-w-0 flex-col items-center gap-2.5 p-4">
        <p className="fig-label">Most found in</p>
        {coverImage && (
          <div className="wd-vn-art w-24 h-[130px]">
            {coverImage}
          </div>
        )}
        <div className="text-center">
          <p className="wd-vn-name">
            {displayTitle}
          </p>
          {vn.occurrences != null && (
            <p className="wd-vn-meta mt-1">
              {vn.occurrences.toLocaleString()} occurrences
            </p>
          )}
        </div>
      </div>
    </Wrapper>
  );
}
