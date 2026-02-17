'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { X, ExternalLink, Calendar, Building2, ImageOff } from 'lucide-react';
import type { NewsItem } from '@/lib/sample-news-data';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';

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
  // VNDB IDs are a letter prefix + numeric ID
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

interface DigestModalProps {
  title: string;
  items: NewsItem[];
  onClose: () => void;
}

export function DigestModal({ title, items, onClose }: DigestModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  // Focus management: focus modal on mount, restore focus on unmount
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="digest-modal-title">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div ref={modalRef} tabIndex={-1} className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[85vh] overflow-hidden outline-none">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between z-10">
          <h2 id="digest-modal-title" className="text-xl font-bold text-gray-900 dark:text-white">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(85vh-70px)] p-4 sm:p-6">
          <div className="grid gap-4">
            {items.map((item) => (
              <DigestItemCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Type for release editions
interface ReleaseEdition {
  id: string;
  title: string;
  alttitle?: string;
  platforms?: string[];
}

function DigestItemCard({ item }: { item: NewsItem }) {
  const hasValidImage = item.imageUrl && !item.imageIsNsfw;
  const { preference } = useTitlePreference();

  // Get display title based on preference (for VNDB sources)
  const isVndbSource = item.source === 'vndb' || item.source === 'vndb_release';
  const displayTitle = isVndbSource
    ? getDisplayTitle({
        title: item.title,
        title_jp: extractString(item.extraData?.alttitle),
      }, preference)
    : item.title;

  // Extract developer and release date from extraData with type validation
  const developers = extractStringArray(item.extraData?.developers);
  const released = extractString(item.extraData?.released);
  const releases = extractReleases(item.extraData?.releases);

  // Format release date
  const formattedDate = released ? formatReleaseDate(released) : null;

  const safeUrl = item.url && /^https?:\/\//.test(item.url) ? item.url : undefined;

  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
      <div className="flex gap-3 sm:gap-4">
        {/* Cover Image or Placeholder */}
        <a
          href={safeUrl || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="relative w-16 h-[5.5rem] sm:w-24 sm:h-32 flex-shrink-0 bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
        >
          {hasValidImage ? (
            <Image
              src={getProxiedImageUrl(item.imageUrl, { width: 128 })!}
              alt={item.title}
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <ImageOff className="w-8 h-8 text-gray-400 dark:text-gray-500" />
            </div>
          )}
        </a>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <a
            href={safeUrl || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="group"
          >
            <h3 className="font-semibold text-gray-900 dark:text-white mb-1 line-clamp-2 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
              {displayTitle}
            </h3>
          </a>

          {/* Developer & Release Date */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400 mb-2">
            {developers.length > 0 && (
              <span className="flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5" />
                {developers.slice(0, 2).join(', ')}
              </span>
            )}
            {formattedDate && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {formattedDate}
              </span>
            )}
          </div>

          {/* Release Editions - show individual release links */}
          {releases.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {releases.slice(0, 4).map((release) => {
                const vndbUrl = getVndbUrl(release.id);
                if (!vndbUrl) return null;
                return (
                  <a
                    key={release.id}
                    href={vndbUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {getDisplayTitle({ title: release.title, title_jp: release.alttitle }, preference) || release.id}
                  </a>
                );
              })}
              {releases.length > 4 && (
                <span className="text-xs text-gray-400 self-center">
                  +{releases.length - 4} more
                </span>
              )}
            </div>
          )}

          {/* Summary (only if no releases shown) */}
          {item.summary && releases.length === 0 && (
            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-2">
              {item.summary}
            </p>
          )}

          {/* Content Tags */}
          {(() => {
            // For releases, use extraData.vn_tags; for new VNs, use item.tags
            const vnTags = extractStringArray(item.extraData?.vn_tags);
            const contentTags = vnTags.length > 0 ? vnTags : (item.tags || []);
            return contentTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {contentTags.slice(0, 5).map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
