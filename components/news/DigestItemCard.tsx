'use client';

import { useState } from 'react';
import type { NewsItem } from '@/lib/sample-news-data';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { NSFWNextImage } from '@/components/NSFWImage';

// Format release date from "YYYY-MM-DD" to readable format
function formatReleaseDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// Validate VNDB ID format and return safe URL or null
// Valid formats: v123, r123, p123, s123, c123, g123, i123
function getVndbUrl(id: string): string | null {
  if (!id || typeof id !== 'string') return null;
  const validPattern = /^[vrpscgi]\d+$/;
  if (!validPattern.test(id)) return null;
  return `https://vndb.org/${id}`;
}

// Type-safe extraction helpers for extraData fields
function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function extractString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

interface ReleaseEdition {
  id: string;
  title: string;
  alttitle?: string;
  platforms?: string[];
}

function extractReleases(value: unknown): ReleaseEdition[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ReleaseEdition => {
    return (
      item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.title === 'string'
    );
  });
}

export function DigestItemCard({ item }: { item: NewsItem }) {
  const { preference } = useTitlePreference();

  const isVndbSource = item.source === 'vndb' || item.source === 'vndb_release';
  const displayTitle = isVndbSource
    ? getDisplayTitle({
        title: item.title,
        title_jp: extractString(item.extraData?.alttitle),
      }, preference)
    : item.title;

  const developers = extractStringArray(item.extraData?.developers);
  const released = extractString(item.extraData?.released);
  const releases = extractReleases(item.extraData?.releases);
  const formattedDate = released ? formatReleaseDate(released) : null;

  const safeUrl = item.url && /^https?:\/\//.test(item.url) ? item.url : undefined;

  const [imageError, setImageError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);
  const hasImage = !!item.imageUrl && !imageError;
  const vnId = extractString(item.extraData?.vn_id);

  // For releases, use extraData.vn_tags; for new VNs, use item.tags
  const vnTags = extractStringArray(item.extraData?.vn_tags);
  const contentTags = vnTags.length > 0 ? vnTags : (item.tags || []);

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
        {/* The source's own mark, standing behind the cover and showing through when the
            entry brought none. */}
        <div className="nw-art-none">
          {!faviconError && (
            <img
              src="https://icons.duckduckgo.com/ip3/vndb.org.ico"
              alt=""
              width={32}
              height={32}
              style={{ imageRendering: 'auto' }}
              onError={() => setFaviconError(true)}
            />
          )}
          <span>{item.sourceLabel}</span>
        </div>

        {/* Actual image: layered on top */}
        {hasImage && (
          <NSFWNextImage
            src={getProxiedImageUrl(item.imageUrl, { width: 512 })}
            alt={item.title}
            imageSexual={item.imageIsNsfw ? 2 : 0}
            vnId={vnId}
            fill
            loading="lazy"
            className="object-cover"
            unoptimized
            onError={() => setImageError(true)}
          />
        )}
      </div>

      <div className="nw-body">
        <div className="nw-meta flex-wrap">
          {developers.length > 0 && <span>{developers.slice(0, 2).join(', ')}</span>}
          {formattedDate && <span>{formattedDate}</span>}
          {safeUrl && (
            <span
              className="ml-auto sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
              aria-hidden="true"
            >
              ↗
            </span>
          )}
        </div>

        <h3 className="nw-title line-clamp-2">{displayTitle}</h3>

        {/* Release Editions: clickable links above the stretched card link */}
        {releases.length > 0 && (
          <div className="relative z-10 mb-2 flex flex-wrap items-center gap-1.5">
            {releases.slice(0, 3).map((release) => {
              const vndbUrl = getVndbUrl(release.id);
              if (!vndbUrl) return null;
              return (
                <a
                  key={release.id}
                  href={vndbUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xs border border-[color:var(--rule)] px-2 py-0.5 text-xs text-[color:var(--nezu)] transition-colors hover:border-[color:var(--kohaku)] hover:text-[color:var(--ink)]"
                >
                  {getDisplayTitle({ title: release.title, title_jp: release.alttitle }, preference) || release.id}
                </a>
              );
            })}
            {releases.length > 3 && (
              <span className="self-center font-mono text-xs tabular-nums text-[color:var(--text-faint)]">
                +{releases.length - 3} more
              </span>
            )}
          </div>
        )}

        {/* Content Tags */}
        {contentTags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1">
            {contentTags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-xs border border-[color:var(--rule)] px-2 py-0.5 text-xs text-[color:var(--nezu)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
