'use client';

import Link from '@/components/Link';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { NSFWNextImage } from '@/components/NSFWImage';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import type { VNOfTheDayData } from '@/lib/vn-of-the-day';

interface VNOfTheDayBannerProps {
  data: VNOfTheDayData;
}

export function VNOfTheDayBanner({ data }: VNOfTheDayBannerProps) {
  const { preference } = useTitlePreference();

  const numericId = data.vn_id.replace(/\D/g, '');
  const vnUrl = `/vn/${numericId}/`;
  const displayTitle = getDisplayTitle(
    { title: data.title, title_jp: data.title_jp ?? undefined, title_romaji: data.title_romaji ?? undefined },
    preference
  );
  const imageUrl = getProxiedImageUrl(data.image_url, { width: 128 });

  return (
    <Link href={vnUrl} className="rel-row">
      {imageUrl && (
        <span className="rel-art">
          <NSFWNextImage
            src={imageUrl}
            alt={data.title}
            imageSexual={data.image_sexual}
            vnId={data.vn_id}
            fill
            sizes="56px"
            className="object-cover"
            hideOverlay
          />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="nameplate nameplate--plain">VN of the Day</span>
        <span className="rel-title mt-1 truncate">{displayTitle}</span>
        {data.rating != null && data.votecount != null && (
          <span className="rel-meta font-mono tabular-nums">
            {data.rating.toFixed(2)} ({data.votecount.toLocaleString()} votes)
          </span>
        )}
      </span>

      <span className="rel-when self-center" aria-hidden="true">
        →
      </span>
    </Link>
  );
}
