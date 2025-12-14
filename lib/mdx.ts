import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { getGitDates } from './git-dates';

const CONTENT_DIR = path.join(process.cwd(), 'content');

// Cache parsed content to avoid re-reading and re-parsing files
// Skip caching in development for hot reload support
const contentCache = new Map<string, Post>();
const isDev = process.env.NODE_ENV === 'development';

export interface Post {
  slug: string;
  title: string;
  description?: string;
  date?: string;
  updated?: string;
  content: string;
  [key: string]: unknown;
}

// Extract title from first H1 heading in content
function extractTitleFromContent(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

export function getContentBySlug(type: 'guides', slug: string): Post | null {
  const cacheKey = `${type}:${slug}`;

  // Check cache first (skip in development for hot reload)
  if (!isDev && contentCache.has(cacheKey)) {
    return contentCache.get(cacheKey)!;
  }

  try {
    const fullPath = path.join(CONTENT_DIR, type, `${slug}.mdx`);
    const fileContents = fs.readFileSync(fullPath, 'utf8');
    const { data, content } = matter(fileContents);

    // Get git dates for the file
    const gitDates = getGitDates(fullPath);

    // Get title from frontmatter (if non-empty), or extract from first H1, or fall back to slug
    const title = (data.title && data.title.trim()) || extractTitleFromContent(content) || slug;

    // Convert dates to ISO strings (gray-matter auto-converts date strings to Date objects)
    const normalizeDate = (date: unknown): string | undefined => {
      if (!date) return undefined;
      if (date instanceof Date) return date.toISOString();
      if (typeof date === 'string') return date;
      return undefined;
    };

    // Destructure to exclude date fields from spread (they get normalized separately)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { date: _date, updated: _updated, ...restData } = data;

    const post = {
      slug,
      title,
      description: data.description,
      date: normalizeDate(data.date) || gitDates.created,  // From frontmatter or git first commit
      updated: normalizeDate(data.updated) || gitDates.updated,  // From frontmatter or git
      content,
      ...restData,
    };

    // Cache the result (only in production)
    if (!isDev) {
      contentCache.set(cacheKey, post);
    }

    return post;
  } catch (error) {
    console.error(`Failed to load content for ${slug}`, error);
    return null;
  }
}

export function getAllContent(type: 'guides'): Post[] {
  const directory = path.join(CONTENT_DIR, type);
  
  try {
    const files = fs.readdirSync(directory);
    const posts = files
      .filter((file) => file.endsWith('.mdx'))
      .map((file) => {
        const slug = file.replace(/\.mdx$/, '');
        return getContentBySlug(type, slug);
      })
      .filter((post): post is Post => post !== null)
      .sort((a, b) => {
        if (a.date && b.date) {
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        }
        return 0;
      });

    return posts;
  } catch (error) {
    console.error(`Failed to load content list for ${type}`, error);
    return [];
  }
}
