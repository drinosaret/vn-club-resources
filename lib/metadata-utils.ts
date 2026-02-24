/**
 * Shared metadata utilities for SEO and social sharing.
 * Provides consistent Open Graph, Twitter Card, and canonical URL generation.
 */

import { Metadata } from 'next';
import { stripBBCode } from './bbcode';
export { stripBBCode };

/**
 * Safely serialize JSON-LD data for embedding in a <script> tag.
 * Escapes characters that could break out of the script context.
 */
export function safeJsonLdStringify(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

export const SITE_NAME = 'VN Club';
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://vnclub.org';
export const DEFAULT_OG_IMAGE = '/assets/hikaru-icon2.webp';

export interface MetadataInput {
  title: string;
  description: string;
  path: string;
  image?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  type?: 'website' | 'article';
  noIndex?: boolean;
  largeImage?: boolean;
}

/**
 * Generate consistent page metadata with Open Graph and Twitter Card support.
 * Used across all pages for Discord link previews and SEO.
 */
export function generatePageMetadata({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
  imageAlt,
  imageWidth,
  imageHeight,
  type = 'website',
  noIndex = false,
  largeImage = false,
}: MetadataInput): Metadata {
  // Use relative paths — Next.js resolves them against the dynamic metadataBase
  // set in app/layout.tsx (which reads the Host header).
  const isDefaultImage = image === DEFAULT_OG_IMAGE;
  const ogWidth = imageWidth || (isDefaultImage ? 512 : undefined);
  const ogHeight = imageHeight || (isDefaultImage ? 512 : undefined);

  return {
    title,
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      type,
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      images: [
        {
          url: image,
          ...(ogWidth && { width: ogWidth }),
          ...(ogHeight && { height: ogHeight }),
          alt: imageAlt || title,
        },
      ],
    },
    twitter: {
      card: largeImage && !isDefaultImage ? 'summary_large_image' : 'summary',
      title,
      description,
      images: [image],
    },
    robots: noIndex ? { index: false, follow: true } : undefined,
  };
}

/**
 * Check if a VN image is safe for social media previews.
 * VNDB uses image_sexual >= 1.5 for explicit content.
 */
export function isSafeForOG(imageSexual?: number): boolean {
  return !imageSexual || imageSexual < 1.5;
}

/**
 * Get the proxied/cached image path for a VNDB image URL.
 * Returns fallback image if URL is invalid or image is NSFW.
 */
export function getOGImagePath(vndbUrl?: string, imageSexual?: number): string {
  if (!vndbUrl || !isSafeForOG(imageSexual)) {
    return DEFAULT_OG_IMAGE;
  }

  try {
    const url = new URL(vndbUrl);
    if (url.hostname === 't.vndb.org') {
      // Convert VNDB URL to /img/ route path (served by API route from .cache/)
      const webpPath = url.pathname.replace(/\.(jpg|jpeg)$/i, '.webp');
      return `/img${webpPath}`;
    }
  } catch {
    // Invalid URL
  }

  return DEFAULT_OG_IMAGE;
}

/**
 * Truncate text for meta descriptions (150-200 chars recommended).
 * Strips BBCode and collapses all whitespace to single spaces
 * so OG/Twitter descriptions render as a clean single line.
 */
export function truncateDescription(text: string, maxLength = 200): string {
  const stripped = stripBBCode(text);
  const cleaned = stripped.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength - 3).trim() + '...';
}

/**
 * Generate JSON-LD BreadcrumbList schema.
 * Last item should be the current page.
 */
export function generateBreadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}

/**
 * Build a keyword-rich meta description for VN detail pages.
 * Includes VN name, release year, developer, rating, and keywords.
 * Falls back to a composed description instead of generic text.
 */
export function buildVNMetaDescription(vn: {
  title: string;
  description?: string;
  released?: string;
  rating?: number;
  developers?: Array<{ name: string }>;
}): string {
  // Try composing a structured description with key VN info
  const parts: string[] = [];

  const year = vn.released?.substring(0, 4);
  const developer = vn.developers?.[0]?.name;
  const ratingStr = vn.rating ? (vn.rating / 100).toFixed(1) : null;

  // Lead with title + year + developer
  if (year && developer) {
    parts.push(`${vn.title} (${year}) by ${developer}`);
  } else if (year) {
    parts.push(`${vn.title} (${year})`);
  } else {
    parts.push(vn.title);
  }

  // Add rating
  if (ratingStr) {
    parts.push(`rated ${ratingStr}/10`);
  }

  const prefix = parts.join(' — ');

  // If VNDB description exists, append a truncated version
  if (vn.description) {
    const cleaned = truncateDescription(vn.description, 155 - prefix.length - 3);
    if (cleaned.length > 20) {
      return truncateDescription(`${prefix}. ${cleaned}`, 155);
    }
  }

  // Fallback: structured info + generic tail
  return truncateDescription(
    `${prefix}. Visual novel details, characters, tags, and screenshots on VN Club.`,
    155,
  );
}

/**
 * Generate JSON-LD VideoGame schema for VN detail pages.
 */
export function generateVNJsonLd(vn: {
  id: string;
  title: string;
  title_jp?: string;
  description?: string;
  image_url?: string;
  released?: string;
  updated_at?: string;
  rating?: number;
  votecount?: number;
  developers?: Array<{ name: string }>;
  platforms?: string[];
  tags?: Array<{ name: string; category?: string; score: number; spoiler: number }>;
}) {
  const cleanDescription = vn.description
    ? truncateDescription(vn.description, 500)
    : undefined;

  // Build genre array from content tags (non-spoiler, high-scoring)
  const genreTags = vn.tags
    ?.filter((t) => t.category === 'cont' && t.spoiler === 0 && t.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((t) => t.name) ?? [];
  const genres = ['Visual Novel', ...genreTags];

  // Use actual platforms if available
  const platforms = vn.platforms?.length ? vn.platforms : ['PC'];

  const vnId = vn.id.startsWith('v') ? vn.id : `v${vn.id}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: vn.title,
    ...(vn.title_jp && { alternateName: vn.title_jp }),
    description: cleanDescription,
    image: vn.image_url,
    datePublished: vn.released,
    ...(vn.updated_at && { dateModified: vn.updated_at }),
    aggregateRating:
      vn.rating && vn.votecount
        ? {
            '@type': 'AggregateRating',
            ratingValue: vn.rating,
            ratingCount: vn.votecount,
            bestRating: 10,
            worstRating: 1,
          }
        : undefined,
    author: vn.developers?.map((d) => ({
      '@type': 'Organization',
      name: d.name,
    })),
    url: `${SITE_URL}/vn/${vnId}/`,
    sameAs: `https://vndb.org/${vnId}`,
    genre: genres,
    gamePlatform: platforms,
    inLanguage: 'ja',
  };
}
