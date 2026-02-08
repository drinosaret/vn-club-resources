/**
 * Shared metadata utilities for SEO and social sharing.
 * Provides consistent Open Graph, Twitter Card, and canonical URL generation.
 */

import { Metadata } from 'next';

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
export const SITE_URL = 'https://vnclub.org';
export const DEFAULT_OG_IMAGE = '/assets/hikaru-icon2.webp';

export interface MetadataInput {
  title: string;
  description: string;
  path: string;
  image?: string;
  imageAlt?: string;
  type?: 'website' | 'article';
  noIndex?: boolean;
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
  type = 'website',
  noIndex = false,
}: MetadataInput): Metadata {
  const url = `${SITE_URL}${path}`;
  const fullImageUrl = image.startsWith('http') ? image : `${SITE_URL}${image}`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type,
      title,
      description,
      url,
      siteName: SITE_NAME,
      images: [
        {
          url: fullImageUrl,
          width: 512,
          height: 512,
          alt: imageAlt || title,
        },
      ],
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: [fullImageUrl],
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
 * Strip BBCode tags from VNDB descriptions for plain text metadata.
 */
export function stripBBCode(text: string): string {
  return text
    .replace(/\[url=[^\]]*\]/gi, '')
    .replace(/\[\/url\]/gi, '')
    .replace(/\[spoiler\][\s\S]*?\[\/spoiler\]/gi, '')
    .replace(/\[[^\]]+\]/g, '')
    .trim();
}

/**
 * Truncate text for meta descriptions (150-200 chars recommended).
 */
export function truncateDescription(text: string, maxLength = 200): string {
  const cleaned = stripBBCode(text);
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength - 3).trim() + '...';
}

/**
 * Generate JSON-LD VideoGame schema for VN detail pages.
 */
export function generateVNJsonLd(vn: {
  id: string;
  title: string;
  description?: string;
  image_url?: string;
  released?: string;
  rating?: number;
  votecount?: number;
  developers?: Array<{ name: string }>;
}) {
  const cleanDescription = vn.description
    ? truncateDescription(vn.description, 500)
    : undefined;

  return {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: vn.title,
    description: cleanDescription,
    image: vn.image_url,
    datePublished: vn.released,
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
    url: `${SITE_URL}/vn/${vn.id}`,
    genre: 'Visual Novel',
    gamePlatform: 'PC',
    inLanguage: 'ja',
  };
}
