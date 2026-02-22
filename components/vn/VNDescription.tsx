'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

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
        className={`prose prose-sm dark:prose-invert max-w-none text-gray-600 dark:text-gray-300 ${
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
          className="mt-3 flex items-center gap-1 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
        >
          {isExpanded ? (
            <>
              Show less <ChevronUp className="w-4 h-4" />
            </>
          ) : (
            <>
              Show more <ChevronDown className="w-4 h-4" />
            </>
          )}
        </button>
      )}
    </>
  );

  if (bare) {
    return <div>{content}</div>;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-100 dark:border-gray-700 shadow-xs">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Description
        </h2>
      </div>
      {content}
    </div>
  );
}

/**
 * Escape HTML entities to prevent XSS attacks.
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
 * Validate URL to prevent javascript: and data: protocol attacks.
 * Uses case-insensitive checks to prevent bypass via jaVasCript: etc.
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
    return url.startsWith('/') || url.startsWith('#') || url.startsWith('?');
  }
}

// Clean VNDB description formatting codes with XSS protection
function cleanVNDBDescription(text: string): string {
  // First, escape all HTML in the input to prevent injection
  let result = escapeHtml(text);

  // Convert VNDB links to HTML links (with URL validation)
  result = result.replace(/\[url=([^\]]+)\]([^\[]+)\[\/url\]/gi, (match, url, linkText) => {
    // Decode HTML entities in URL for validation (they were escaped above)
    const decodedUrl = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    if (isValidUrl(decodedUrl)) {
      // Re-escape the URL for the href attribute
      const safeUrl = escapeHtml(decodedUrl);
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-primary-600 dark:text-primary-400 hover:underline">${linkText}</a>`;
    }
    // Invalid URL - just show as plain text
    return linkText;
  });

  // [spoiler]...[/spoiler] - hide spoilers
  result = result.replace(/\[spoiler\][\s\S]*?\[\/spoiler\]/gi, '<span class="italic text-gray-400">[Spoiler hidden]</span>');

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
  result = result.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, '<blockquote class="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic">$1</blockquote>');

  // Convert line breaks to <br> for display
  // Handle both actual newlines and literal \n sequences (from JSON/database)
  result = result.replace(/\\n/g, '<br>');
  result = result.replace(/\n/g, '<br>');

  // Clean up any remaining BBCode tags
  result = result.replace(/\[\/?[a-zA-Z]+(?:=[^\]]+)?\]/g, '');

  return result;
}
