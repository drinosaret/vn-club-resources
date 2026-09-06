'use client';

import { useState, useMemo } from 'react';

interface VNDescriptionProps {
  description?: string;
  maxLines?: number;
  /** When true, render without card wrapper and heading */
  bare?: boolean;
}

export function VNDescription({ description, maxLines = 4, bare = false }: VNDescriptionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Clean and format the VNDB description
  const formattedDescription = useMemo(() => {
    if (!description) return null;
    return cleanVNDBDescription(description);
  }, [description]);

  if (!formattedDescription) {
    return null;
  }

  // Rough estimate if description needs truncation (about 80 chars per line)
  const needsTruncation = description && description.length > maxLines * 80;

  const content = (
    <>
      <div
        className={`prose max-w-none text-[color:var(--text-secondary)] ${
          !isExpanded && needsTruncation ? `line-clamp-${maxLines}` : ''
        }`}
        style={!isExpanded && needsTruncation ? {
          display: '-webkit-box',
          WebkitLineClamp: maxLines,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        } : undefined}
        dangerouslySetInnerHTML={{ __html: formattedDescription }}
      />

      {needsTruncation && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          className="sec-more mt-3"
        >
          {isExpanded ? 'Show less' : 'Show more'}
          <span aria-hidden>{isExpanded ? '▴' : '▾'}</span>
        </button>
      )}
    </>
  );

  if (bare) {
    return <div>{content}</div>;
  }

  return (
    <div className="vn-sec p-4 sm:p-6">
      <div className="vn-sec-head">
        <h2 className="vn-sec-title">
          Description
        </h2>
      </div>
      {content}
    </div>
  );
}

/**
 * Escape the characters that are markup in an HTML text node.
 */
function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}

/**
 * Whether a URL is one this component will put in an href.
 *
 * Only http and https reach an href. A scheme is not case sensitive, so the comparison
 * is made against the lowercased form.
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow http and https protocols
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    // For relative URLs, check for dangerous protocols (case-insensitive)
    const lower = url.toLowerCase().trim();
    if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
      return false;
    }
    // Only allow relative paths starting with / or # or ?
    return (url.startsWith('/') && !url.startsWith('//')) || url.startsWith('#') || url.startsWith('?');
  }
}

// Render the source's formatting codes as markup. The input is escaped first, so the only
// markup in the result is what this function emits.
function cleanVNDBDescription(text: string): string {
  // Escaped before any markup is added, so nothing in the source can become an element.
  let result = escapeHtml(text);

  // Convert VNDB links to HTML links (with URL validation)
  result = result.replace(/\[url=([^\]]+)\]([^\[]+)\[\/url\]/gi, (match, url, linkText) => {
    // Decode HTML entities in URL for validation (they were escaped above).
    // Unescape &amp; LAST so e.g. "&amp;lt;" decodes to the literal "&lt;", not "<".
    const decodedUrl = url.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    if (isValidUrl(decodedUrl)) {
      // Re-escape the URL for the href attribute
      const safeUrl = escapeHtml(decodedUrl);
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-[color:var(--ai)] hover:underline">${linkText}</a>`;
    }
    // Invalid URL - just show as plain text
    return linkText;
  });

  // [spoiler]...[/spoiler] - hide spoilers
  result = result.replace(/\[spoiler\][\s\S]*?\[\/spoiler\]/gi, '<span class="italic text-[color:var(--text-faint)]">[Spoiler hidden]</span>');

  // Convert BBCode formatting tags to HTML (content already escaped)
  result = result.replace(/\[b\](.*?)\[\/b\]/gi, '<strong>$1</strong>');
  result = result.replace(/\[i\](.*?)\[\/i\]/gi, '<em>$1</em>');
  result = result.replace(/\[u\](.*?)\[\/u\]/gi, '<u>$1</u>');
  result = result.replace(/\[s\](.*?)\[\/s\]/gi, '<s>$1</s>');

  // Remove raw tags, keep escaped content
  result = result.replace(/\[raw\]([\s\S]*?)\[\/raw\]/gi, '$1');
  // Code tags - content is already escaped
  result = result.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, '<code>$1</code>');

  // Quote tags
  result = result.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, '<blockquote class="border-l-2 border-[color:var(--rule)] pl-4 italic">$1</blockquote>');

  // Convert line breaks to <br> for display
  // Handle both actual newlines and literal \n sequences (from JSON/database)
  result = result.replace(/\\n/g, '<br>');
  result = result.replace(/\n/g, '<br>');

  // Clean up any remaining BBCode tags
  result = result.replace(/\[\/?[a-zA-Z]+(?:=[^\]]+)?\]/g, '');

  return result;
}
