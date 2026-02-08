import React from 'react';

export interface BBCodeOptions {
  showSpoilers?: boolean;
}

/**
 * Validate URL to prevent XSS via javascript: or data: protocols.
 * Only allows http:// and https:// URLs.
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    // Invalid URL or relative URL - allow same-origin relative URLs only
    return url.startsWith('/') && !url.startsWith('//');
  }
}

/**
 * Check if text contains [spoiler] BBCode tags.
 */
export function hasSpoilerContent(text: string): boolean {
  return /\[spoiler\]/i.test(text);
}

/**
 * Parse VNDB BBCode markup into React elements.
 * Handles: [url=...]...[/url], [b], [i], [u], [s], [spoiler], newlines.
 * Strips remaining unrecognized BBCode tags.
 *
 * @param text - Raw BBCode string
 * @param options.showSpoilers - When true, spoiler content is visible. Default: false (hidden).
 */
export function parseBBCode(text: string, options: BBCodeOptions = {}): React.ReactNode[] {
  const { showSpoilers = false } = options;

  // Normalize escaped newlines from JSON/database
  let normalized = text.replace(/\\n/g, '\n');

  // Strip formatting tags (keep inner text)
  normalized = normalized.replace(/\[\/?(b|i|u|s|raw|code|quote)\]/gi, '');

  const parts: React.ReactNode[] = [];
  let keyCounter = 0;

  // Split by spoiler tags — handles both [/spoiler] and [spoiler] as closing tag
  // Create new regex each call to avoid global flag state issues
  const spoilerRegex = new RegExp('\\[spoiler\\]([\\s\\S]*?)\\[\\/?spoiler\\]', 'gi');
  let lastIndex = 0;
  let match;

  while ((match = spoilerRegex.exec(normalized)) !== null) {
    // Process text before this spoiler block
    if (match.index > lastIndex) {
      const before = normalized.slice(lastIndex, match.index);
      const result = processInlineContent(before, keyCounter);
      parts.push(...result.nodes);
      keyCounter = result.nextKey;
    }

    // Process spoiler content
    const spoilerText = match[1];
    if (showSpoilers) {
      const result = processInlineContent(spoilerText, keyCounter);
      parts.push(...result.nodes);
      keyCounter = result.nextKey;
    } else {
      parts.push(
        <span
          key={`spoiler-${keyCounter++}`}
          className="inline-block text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded select-none"
        >
          (spoiler hidden)
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Process remaining text after last spoiler
  if (lastIndex < normalized.length) {
    const remaining = normalized.slice(lastIndex);
    const result = processInlineContent(remaining, keyCounter);
    parts.push(...result.nodes);
    keyCounter = result.nextKey;
  }

  return parts.length > 0 ? parts : [text];
}

/**
 * Process inline BBCode content (URLs and line breaks).
 * Used internally by parseBBCode after spoiler extraction.
 */
function processInlineContent(text: string, startKey: number): { nodes: React.ReactNode[]; nextKey: number } {
  const nodes: React.ReactNode[] = [];
  let keyCounter = startKey;
  let lastIndex = 0;

  // Create new regex each call to avoid global flag state issues
  const urlRegex = new RegExp('\\[url=([^\\]]+)\\]([^[]*)\\[\\/url\\]', 'g');
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      nodes.push(...renderTextWithLineBreaks(textBefore, keyCounter));
      keyCounter += textBefore.split('\n').length;
    }

    const url = match[1];
    const linkText = match[2];

    // Validate URL to prevent XSS (javascript:, data: etc.)
    if (isValidUrl(url)) {
      nodes.push(
        <a
          key={`link-${keyCounter++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-600 dark:text-primary-400 hover:underline"
        >
          {linkText}
        </a>
      );
    } else {
      // Invalid URL - render as plain text
      nodes.push(linkText);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    nodes.push(...renderTextWithLineBreaks(remaining, keyCounter));
    keyCounter += remaining.split('\n').length;
  }

  return { nodes, nextKey: keyCounter };
}

function renderTextWithLineBreaks(text: string, startKey: number): React.ReactNode[] {
  // Strip any leftover BBCode tags
  const cleaned = text.replace(/\[\/?[a-zA-Z]+(?:=[^\]]+)?\]/g, '');
  const lines = cleaned.split('\n');
  const result: React.ReactNode[] = [];

  lines.forEach((line, index) => {
    if (index > 0) {
      result.push(<br key={`br-${startKey + index}`} />);
    }
    if (line) {
      result.push(line);
    }
  });

  return result;
}

/**
 * Strip all BBCode markup from text, returning plain text.
 * Useful for truncated previews where React elements aren't needed.
 */
export function stripBBCode(text: string): string {
  let result = text;

  // Normalize escaped newlines
  result = result.replace(/\\n/g, '\n');

  // Strip spoiler content (handles both [/spoiler] and [spoiler] as closing)
  result = result.replace(/\[spoiler\][\s\S]*?\[\/?spoiler\]/gi, '');

  // Convert [url=...]text[/url] to just the link text
  result = result.replace(/\[url=[^\]]+\]([^[]*)\[\/url\]/gi, '$1');

  // Strip all remaining BBCode tags
  result = result.replace(/\[\/?[a-zA-Z]+(?:=[^\]]+)?\]/g, '');

  // Collapse multiple newlines/spaces
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.trim();

  return result;
}
