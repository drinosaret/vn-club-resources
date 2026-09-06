'use client';

import Link from '@/components/Link';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import type { FeaturedVNData } from '@/lib/featured-vns';
import { useImageFade } from '@/hooks/useImageFade';
import { getProxiedImageUrl, getCoverSrcSet, type ImageWidth } from '@/lib/vndb-image-cache';

/** Mirrors the `.shelf` grid: three columns, then four, then six. */
const SHELF_IMAGE_SIZES = '(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 16vw';
const SHELF_SRCSET_WIDTHS: readonly ImageWidth[] = [128, 256];

interface FeaturedVNsProps {
  vns: FeaturedVNData[];
}

/**
 * The shelf renders exactly what it is handed.
 *
 * Which titles appear is decided on the server, once per render window, so the covers in the
 * delivered HTML are the covers a reader sees. Choosing them again in the browser would show
 * one set to anything reading the markup and a different set to everyone else.
 */
export function FeaturedVNs({ vns }: FeaturedVNsProps) {
  const { preference } = useTitlePreference();

  if (vns.length === 0) {
    return null;
  }

  return (
    <>
      <div className="sec-head">
        <div>
          <h2 id="starting-points" className="sec-title">
            Good places to start
          </h2>
          <p className="sec-sub">Well regarded, widely read, and approachable in Japanese.</p>
        </div>
        <Link href="/beginner-vns/" className="sec-more">
          See all beginner recommendations
          <span aria-hidden>→</span>
        </Link>
      </div>

      <ul className="shelf">
        {vns.map((vn) => (
          <li key={vn.id}>
            <FeaturedVNCard vn={vn} preference={preference} />
          </li>
        ))}
      </ul>
    </>
  );
}

function FeaturedVNCard({ vn, preference }: { vn: FeaturedVNData; preference: 'japanese' | 'romaji' }) {
  const { ref, onLoad, fadeClass } = useImageFade();
  const displayTitle = getDisplayTitle(vn, preference);
  const proxiedUrl = getProxiedImageUrl(vn.imageUrl, { width: 256, vnId: vn.id });

  return (
    <Link href={`/vn/${vn.id.replace('v', '')}/`} className="shelf-item block">
      <span className="shelf-art">
        {proxiedUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={ref}
            src={proxiedUrl}
            srcSet={getCoverSrcSet(vn.imageUrl, SHELF_SRCSET_WIDTHS, { vnId: vn.id })}
            sizes={SHELF_IMAGE_SIZES}
            alt={displayTitle}
            loading="lazy"
            decoding="async"
            className={`absolute inset-0 w-full h-full object-cover ${fadeClass}`}
            onLoad={onLoad}
          />
        )}
      </span>
      <span className="shelf-name">{displayTitle}</span>
    </Link>
  );
}
