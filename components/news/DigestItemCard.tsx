'use client';

import { ExternalLink, Calendar, Building2, ImageOff } from 'lucide-react';
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

  const hasImage = !!item.imageUrl;
  const vnId = extractString(item.extraData?.vn_id);

  // For releases, use extraData.vn_tags; for new VNs, use item.tags
  const vnTags = extractStringArray(item.extraData?.vn_tags);
  const contentTags = vnTags.length > 0 ? vnTags : (item.tags || []);

  return (
    <div
      className="relative flex flex-col bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-600 transition-[box-shadow,border-color] duration-150 group h-full"
    >
      {/* Stretched link — makes entire card clickable */}
      {safeUrl && (
        <a
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 z-0"
          aria-label={displayTitle}
        />
      )}

      {/* Cover Image */}
      <div className="relative w-full h-40 shrink-0">
        {hasImage ? (
          <NSFWNextImage
            src={getProxiedImageUrl(item.imageUrl, { width: 512 })}
            alt={item.title}
            imageSexual={item.imageIsNsfw ? 2 : 0}
            vnId={vnId}
            fill
            loading="lazy"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="absolute inset-0 bg-linear-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-indigo-950/50 dark:via-purple-950/50 dark:to-pink-950/50 flex items-center justify-center overflow-hidden">
            <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-white/30 dark:bg-white/5" />
            <div className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-white/30 dark:bg-white/5" />
            <ImageOff className="w-12 h-12 text-indigo-300 dark:text-indigo-700" />
          </div>
        )}
      </div>

      <div className="p-4 flex flex-col grow">
        {/* Developer & Release Date */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mb-2">
          {developers.length > 0 && (
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3" />
              {developers.slice(0, 2).join(', ')}
            </span>
          )}
          {formattedDate && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formattedDate}
            </span>
          )}
          {safeUrl && (
            <ExternalLink className="w-3 h-3 text-gray-400 dark:text-gray-500 ml-auto sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" />
          )}
        </div>

        {/* Title */}
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2 line-clamp-2 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
          {displayTitle}
        </h3>

        {/* Release Editions — clickable links above the stretched card link */}
        {releases.length > 0 && (
          <div className="relative z-10 flex flex-wrap gap-1.5 mb-2">
            {releases.slice(0, 3).map((release) => {
              const vndbUrl = getVndbUrl(release.id);
              if (!vndbUrl) return null;
              return (
                <a
                  key={release.id}
                  href={vndbUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  {getDisplayTitle({ title: release.title, title_jp: release.alttitle }, preference) || release.id}
                </a>
              );
            })}
            {releases.length > 3 && (
              <span className="text-xs text-gray-400 self-center">
                +{releases.length - 3} more
              </span>
            )}
          </div>
        )}

        {/* Content Tags */}
        {contentTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-auto">
            {contentTags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
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
