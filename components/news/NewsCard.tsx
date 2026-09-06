'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { NewsListItem } from '@/lib/sample-news-data';
import { getRelativeTime } from '@/lib/sample-news-data';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { getNewsImageUrl } from '@/lib/vndb-image-cache';
import { useImageFade } from '@/hooks/useImageFade';
import { LinkifiedText } from './LinkifiedText';

interface NewsCardProps {
  item: NewsListItem;
}

export function NewsCard({ item }: NewsCardProps) {
  const relativeTime = getRelativeTime(item.publishedAt);
  const [imageError, setImageError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);
  const { onLoad: onImageLoad, shimmerClass, fadeClass } = useImageFade();
  const { preference } = useTitlePreference();

  // For VNDB sources, use title preference; otherwise use title as-is
  const isVndbSource = item.source === 'vndb' || item.source === 'vndb_release';
  const displayTitle = isVndbSource
    ? getDisplayTitle({
        title: item.title,
        title_jp: item.extraData?.alttitle as string | undefined,
      }, preference)
    : item.title;

  const safeUrl = item.url && /^https?:\/\//.test(item.url) ? item.url : undefined;

  const hasValidImage = item.imageUrl && !item.imageIsNsfw && !imageError;
  const isTwitter = item.source === 'twitter';
  const isRss = item.source === 'rss';

  // For RSS items, extract domain for favicon; for VNDB, use vndb.org favicon
  const faviconUrl = !faviconError && (
    isRss && safeUrl
      ? `https://icons.duckduckgo.com/ip3/${new URL(safeUrl).hostname}.ico`
      : isVndbSource
      ? 'https://icons.duckduckgo.com/ip3/vndb.org.ico'
      : null
  );

  return (
    <div className="nw-card group">
      {/* Stretched link: makes entire card clickable */}
      {safeUrl && (
        <a
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 z-0"
          aria-label={displayTitle}
        />
      )}

      <div className="nw-art">
        {/* The source's own mark, standing behind the picture and showing through when the
            item brought none. */}
        <div className="nw-art-none">
          {faviconUrl && (
            <img
              src={faviconUrl}
              alt=""
              width={32}
              height={32}
              style={{ imageRendering: 'auto' }}
              onError={() => setFaviconError(true)}
            />
          )}
          <span>{item.sourceLabel}</span>
        </div>

        {/* Actual image: layered on top, fades in on load */}
        {hasValidImage && (
          <>
            <div className={shimmerClass} />
            <Image
              src={getNewsImageUrl(item.imageUrl)!}
              alt={item.title}
              fill
              loading="lazy"
              className={`object-cover ${fadeClass}`}
              onError={() => setImageError(true)}
              onLoad={onImageLoad}
              unoptimized
            />
          </>
        )}
      </div>

      <div className="nw-body">
        <div className="nw-meta">
          <span className="nameplate nameplate--plain">{item.sourceLabel}</span>
          <span>{relativeTime}</span>
          {safeUrl && (
            <span
              className="ml-auto sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
              aria-hidden="true"
            >
              ↗
            </span>
          )}
        </div>

        {/* Title (skip for Twitter: summary already has the full tweet text) */}
        {!isTwitter && <h3 className="nw-title line-clamp-2">{displayTitle}</h3>}

        {/* Summary: URLs are linkified and clickable above the card's stretched link */}
        {item.summary && (
          <div className={`nw-summary relative z-10 ${isTwitter ? 'line-clamp-5' : 'line-clamp-3'}`}>
            <LinkifiedText text={item.summary} />
          </div>
        )}
      </div>
    </div>
  );
}
