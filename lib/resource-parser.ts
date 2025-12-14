/**
 * Resource Parser
 * Parses markdown content to extract resource items and sections
 * for rendering as cards instead of bullet lists.
 */

import { generateHeadingId } from './slug-utils';

export interface ResourceSubItem {
  name: string;
  url: string | null;
  description: string;
}

export interface ResourceItem {
  name: string;
  url: string | null;
  description: string;
  guideUrl: string | null;
  isRecommended: boolean;
  subItems: ResourceSubItem[];
}

export interface ResourceSubsection {
  id: string;
  title: string | null;
  description: string | null;
  items: ResourceItem[];
  isRecommended: boolean;
}

export interface ResourceSection {
  id: string;
  title: string;
  description: string | null;
  subsections: ResourceSubsection[];
}

export interface RelatedLink {
  text: string;
  url: string;
  description: string;
}

export interface RelatedCategory {
  title: string;
  links: RelatedLink[];
}

export type ContentBlock =
  | { type: 'resource-section'; section: ResourceSection }
  | { type: 'related-pages'; categories: RelatedCategory[] }
  | { type: 'markdown'; content: string };

// Generate a slug from a heading - use shared utility for consistency
function slugify(text: string): string {
  return generateHeadingId(text);
}

// Parse a single list item into a ResourceItem
// isInRecommendedSection determines the recommended status, NOT bold formatting
function parseListItem(line: string, isInRecommendedSection: boolean): ResourceItem | null {
  // Remove leading "- " or "* "
  const content = line.replace(/^[-*]\s*/, '').trim();

  if (!content) return null;

  // Pattern 1: **[Name](url)** — Description | [Link Text](url)
  // Only treat as guide if it's an internal link (starts with /) or link text contains "guide"
  const boldLinkWithTrailingLink = /^\*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s*[—–-]\s*(.+?)\s*\|\s*\[([^\]]+)\]\(([^)]+)\)$/;
  let match = content.match(boldLinkWithTrailingLink);
  if (match) {
    const trailingLinkText = match[4];
    const trailingLinkUrl = match[5];
    const isGuideLink = trailingLinkUrl.startsWith('/') || /guide/i.test(trailingLinkText);

    return {
      name: match[1],
      url: match[2],
      description: isGuideLink ? match[3].trim() : `${match[3].trim()} | [${trailingLinkText}](${trailingLinkUrl})`,
      guideUrl: isGuideLink ? trailingLinkUrl : null,
      isRecommended: isInRecommendedSection,
      subItems: [],
    };
  }

  // Pattern 2: **[Name](url)** — Description (bold link with em dash)
  const boldLinkWithDesc = /^\*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s*[—–-]\s*(.+)$/;
  match = content.match(boldLinkWithDesc);
  if (match) {
    return {
      name: match[1],
      url: match[2],
      description: match[3].trim(),
      guideUrl: null,
      isRecommended: isInRecommendedSection,
      subItems: [],
    };
  }

  // Pattern 3: [Name](url) — Description | [Link Text](url)
  // Only treat as guide if it's an internal link (starts with /) or link text contains "guide"
  const linkWithTrailingLink = /^\[([^\]]+)\]\(([^)]+)\)\s*[—–-]\s*(.+?)\s*\|\s*\[([^\]]+)\]\(([^)]+)\)$/;
  match = content.match(linkWithTrailingLink);
  if (match) {
    const trailingLinkText = match[4];
    const trailingLinkUrl = match[5];
    const isGuideLink = trailingLinkUrl.startsWith('/') || /guide/i.test(trailingLinkText);

    return {
      name: match[1],
      url: match[2],
      description: isGuideLink ? match[3].trim() : `${match[3].trim()} | [${trailingLinkText}](${trailingLinkUrl})`,
      guideUrl: isGuideLink ? trailingLinkUrl : null,
      isRecommended: isInRecommendedSection,
      subItems: [],
    };
  }

  // Pattern 4: [Name](url) — Description (simple link with em dash)
  const linkWithDesc = /^\[([^\]]+)\]\(([^)]+)\)\s*[—–-]\s*(.+)$/;
  match = content.match(linkWithDesc);
  if (match) {
    return {
      name: match[1],
      url: match[2],
      description: match[3].trim(),
      guideUrl: null,
      isRecommended: isInRecommendedSection,
      subItems: [],
    };
  }

  // Pattern 5: **[Name](url)** (bold link only, description may follow)
  const boldLinkOnly = /^\*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s*$/;
  match = content.match(boldLinkOnly);
  if (match) {
    return {
      name: match[1],
      url: match[2],
      description: '',
      guideUrl: null,
      isRecommended: isInRecommendedSection,
      subItems: [],
    };
  }

  // Pattern 6: [Name](url) (simple link only)
  const linkOnly = /^\[([^\]]+)\]\(([^)]+)\)\s*$/;
  match = content.match(linkOnly);
  if (match) {
    return {
      name: match[1],
      url: match[2],
      description: '',
      guideUrl: null,
      isRecommended: isInRecommendedSection,
      subItems: [],
    };
  }

  return null;
}

// Parse a sub-list item (indented) into a ResourceSubItem
function parseSubListItem(line: string): ResourceSubItem | null {
  // Remove leading whitespace and "- " or "* "
  const content = line.replace(/^\s*[-*]\s*/, '').trim();

  if (!content) return null;

  // Pattern: **[Name](url)** — Description
  const boldLinkWithDesc = /^\*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s*[—–-]\s*(.+)$/;
  let match = content.match(boldLinkWithDesc);
  if (match) {
    return {
      name: match[1],
      url: match[2],
      description: match[3].trim(),
    };
  }

  // Pattern: [Name](url) — Description
  const linkWithDesc = /^\[([^\]]+)\]\(([^)]+)\)\s*[—–-]\s*(.+)$/;
  match = content.match(linkWithDesc);
  if (match) {
    return {
      name: match[1],
      url: match[2],
      description: match[3].trim(),
    };
  }

  // Pattern: **[Name](url)** (bold link only)
  const boldLinkOnly = /^\*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s*$/;
  match = content.match(boldLinkOnly);
  if (match) {
    return {
      name: match[1],
      url: match[2],
      description: '',
    };
  }

  // Pattern: [Name](url) (simple link only)
  const linkOnly = /^\[([^\]]+)\]\(([^)]+)\)\s*$/;
  match = content.match(linkOnly);
  if (match) {
    return {
      name: match[1],
      url: match[2],
      description: '',
    };
  }

  return null;
}

// Check if a line is a list item
function isListItem(line: string): boolean {
  return /^[-*]\s+/.test(line);
}

// Check if a line is a sub-list item (indented)
function isSubListItem(line: string): boolean {
  return /^\s{2,}[-*]\s+/.test(line);
}

// Parse a section of content under an H2 heading
function parseSection(title: string, content: string): ResourceSection {
  const section: ResourceSection = {
    id: slugify(title),
    title,
    description: null,
    subsections: [],
  };

  const lines = content.split('\n');
  let currentSubsection: ResourceSubsection | null = null;
  let isInRecommendedContext = false;
  let lastItem: ResourceItem | null = null;

  const flushSubsection = () => {
    if (currentSubsection && currentSubsection.items.length > 0) {
      section.subsections.push(currentSubsection);
    }
    currentSubsection = null;
  };

  const createDefaultSubsection = () => {
    if (!currentSubsection) {
      currentSubsection = {
        id: section.id + '-items',
        title: null,
        description: null,
        items: [],
        isRecommended: isInRecommendedContext,
      };
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Check for H3 heading
    if (trimmedLine.startsWith('### ')) {
      flushSubsection();
      const h3Title = trimmedLine.replace(/^###\s*/, '');
      const isRecommended = /recommended/i.test(h3Title);
      isInRecommendedContext = isRecommended;

      currentSubsection = {
        id: slugify(h3Title),
        title: h3Title,
        description: null,
        items: [],
        isRecommended,
      };
      lastItem = null;
      continue;
    }

    // Check for bold "Recommended:" or "Other Sources:" markers
    if (/^\*\*Recommended:?\*\*\s*$/i.test(trimmedLine) || /^\*\*Other Sources?:?\*\*\s*$/i.test(trimmedLine)) {
      flushSubsection();
      const isRecommended = /recommended/i.test(trimmedLine);
      isInRecommendedContext = isRecommended;

      currentSubsection = {
        id: section.id + (isRecommended ? '-recommended' : '-other'),
        title: isRecommended ? 'Recommended' : 'Other Sources',
        description: null,
        items: [],
        isRecommended,
      };
      lastItem = null;
      continue;
    }

    // Skip blockquotes - they'll be handled separately
    if (trimmedLine.startsWith('>')) {
      continue;
    }

    // Check for list items
    if (isListItem(line) && !isSubListItem(line)) {
      createDefaultSubsection();

      const item = parseListItem(line, isInRecommendedContext);
      if (item) {
        currentSubsection!.items.push(item);
        lastItem = item;
      }
      continue;
    }

    // Check for sub-list items (indented with - or *)
    if (isSubListItem(line) && lastItem) {
      const subItem = parseSubListItem(line);
      if (subItem) {
        lastItem.subItems.push(subItem);
      }
      continue;
    }

    // Check for indented continuation of description (multi-line descriptions)
    // Only if it's not a list item pattern
    if (lastItem && trimmedLine && !isListItem(line) && !isSubListItem(line) && line.startsWith('  ')) {
      // This is a continuation of the previous item's description
      if (lastItem.description) {
        lastItem.description += ' ' + trimmedLine;
      } else {
        lastItem.description = trimmedLine;
      }
      continue;
    }

    // Reset lastItem if we hit a blank line
    if (!trimmedLine) {
      lastItem = null;
    }
  }

  flushSubsection();

  return section;
}

// Parse a Related Pages section into categories
function parseRelatedPages(content: string): RelatedCategory[] {
  const categories: RelatedCategory[] = [];
  const lines = content.split('\n');
  let currentCategory: RelatedCategory | null = null;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Check for category header: **Category Name:**
    const categoryMatch = trimmedLine.match(/^\*\*(.+?):\*\*\s*$/);
    if (categoryMatch) {
      if (currentCategory && currentCategory.links.length > 0) {
        categories.push(currentCategory);
      }
      currentCategory = {
        title: categoryMatch[1],
        links: [],
      };
      continue;
    }

    // Check for link items: - [Text](url) - Description or - [Text](url) – Description
    if (trimmedLine.startsWith('-') && currentCategory) {
      const linkContent = trimmedLine.replace(/^-\s*/, '');

      // Pattern: [Text](url) - Description or [Text](url) – Description
      const linkMatch = linkContent.match(/^\[([^\]]+)\]\(([^)]+)\)\s*[—–-]\s*(.+)$/);
      if (linkMatch) {
        currentCategory.links.push({
          text: linkMatch[1],
          url: linkMatch[2],
          description: linkMatch[3].trim(),
        });
        continue;
      }

      // Pattern: [Text](url) (link only, no description)
      const linkOnlyMatch = linkContent.match(/^\[([^\]]+)\]\(([^)]+)\)\s*$/);
      if (linkOnlyMatch) {
        currentCategory.links.push({
          text: linkOnlyMatch[1],
          url: linkOnlyMatch[2],
          description: '',
        });
        continue;
      }
    }
  }

  // Don't forget the last category
  if (currentCategory && currentCategory.links.length > 0) {
    categories.push(currentCategory);
  }

  return categories;
}

// Check if content has H3 subheadings with explanatory paragraphs (not just lists)
// This catches sections like "Dictionary Integration" which have H3s with prose
function hasExplanatoryH3Content(content: string): boolean {
  const lines = content.split('\n');
  let afterH3 = false;
  let foundParagraphAfterH3 = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for H3 heading
    if (trimmed.startsWith('### ')) {
      afterH3 = true;
      continue;
    }

    // After an H3, look for non-list, non-empty content
    if (afterH3 && trimmed) {
      // Skip if it's a list item, blockquote, bold marker, or another heading
      if (/^[-*]\s+/.test(trimmed)) {
        afterH3 = false; // Found a list, stop checking this H3
        continue;
      }
      if (/^>\s*/.test(trimmed)) continue;
      if (/^\*\*[^*]+:\*\*\s*$/.test(trimmed)) continue;
      if (/^#{1,6}\s+/.test(trimmed)) {
        afterH3 = trimmed.startsWith('### '); // Reset for new H3
        continue;
      }

      // Found a paragraph or other content after H3 (not a list)
      // Check it's not just an image alone
      if (!trimmed.startsWith('![') && !trimmed.startsWith('<img')) {
        foundParagraphAfterH3 = true;
        break;
      }
    }
  }

  return foundParagraphAfterH3;
}

// Main parsing function
export function parseResourceContent(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  // Split by H2 headings
  const h2Pattern = /^## (.+)$/gm;
  const parts: string[] = [];
  const headings: string[] = [];

  let lastIndex = 0;
  let match;

  while ((match = h2Pattern.exec(content)) !== null) {
    // Get content before this heading
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    } else if (parts.length === 0) {
      parts.push('');
    }

    headings.push(match[1]);
    lastIndex = match.index + match[0].length;
  }

  // Get remaining content after last heading
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  // First part is content before any H2 (intro/header)
  if (parts[0] && parts[0].trim()) {
    blocks.push({ type: 'markdown', content: parts[0].trim() });
  }

  // Process each H2 section
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const sectionContent = parts[i + 1] || '';

    // Parse "Related Pages" section into structured categories
    if (/related pages?/i.test(heading)) {
      const categories = parseRelatedPages(sectionContent);
      if (categories.length > 0) {
        blocks.push({ type: 'related-pages', categories });
      } else {
        // Fallback to markdown if no categories parsed
        blocks.push({
          type: 'markdown',
          content: `## ${heading}\n${sectionContent}`,
        });
      }
      continue;
    }

    const section = parseSection(heading, sectionContent);

    // Check if section has H3 subheadings with explanatory paragraphs
    // (like "Dictionary Integration" which has prose under each H3)
    const hasExplanatoryContent = hasExplanatoryH3Content(sectionContent);

    // Only treat as resource section if it has items AND doesn't have explanatory H3 content
    if (section.subsections.some(s => s.items.length > 0) && !hasExplanatoryContent) {
      blocks.push({ type: 'resource-section', section });
    } else {
      // No resource items found or has mixed content - render as regular markdown
      blocks.push({
        type: 'markdown',
        content: `## ${heading}\n${sectionContent}`,
      });
    }
  }

  return blocks;
}

// Extract description from content that appears after a list item
export function extractMultilineDescription(lines: string[], startIndex: number): string {
  const descLines: string[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Stop at next list item, heading, or empty line followed by non-indented content
    if (isListItem(line) || trimmed.startsWith('#') || trimmed.startsWith('>')) {
      break;
    }

    if (trimmed) {
      descLines.push(trimmed);
    } else if (descLines.length > 0) {
      // Empty line after some description - check if next line is indented
      const nextLine = lines[i + 1];
      if (!nextLine || !nextLine.startsWith('  ')) {
        break;
      }
    }
  }

  return descLines.join(' ');
}
