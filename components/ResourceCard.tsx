import Link from 'next/link';
import { ExternalLink, BookOpen } from 'lucide-react';
import type { ResourceItem } from '@/lib/resource-parser';

interface ResourceCardProps {
  resource: ResourceItem;
}

// Render description with inline links parsed from markdown
function renderDescription(description: string) {
  // Match markdown links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match;

  while ((match = linkRegex.exec(description)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      parts.push(description.slice(lastIndex, match.index));
    }

    const [, text, url] = match;
    const isExternal = url.startsWith('http');

    // Add the link
    if (isExternal) {
      parts.push(
        <a
          key={match.index}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-600 dark:text-primary-400 hover:underline pointer-events-auto"
        >
          {text}
        </a>
      );
    } else {
      parts.push(
        <Link
          key={match.index}
          href={url}
          className="text-primary-600 dark:text-primary-400 hover:underline pointer-events-auto"
        >
          {text}
        </Link>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last link
  if (lastIndex < description.length) {
    parts.push(description.slice(lastIndex));
  }

  return parts.length > 0 ? parts : description;
}

export function ResourceCard({ resource }: ResourceCardProps) {
  const isExternal = resource.url?.startsWith('http');
  const hasLink = !!resource.url;

  const cardClasses = `
    relative rounded-xl bg-white dark:bg-gray-800
    border border-gray-200 dark:border-gray-700
    p-5 shadow-sm transition-all duration-200
    ${hasLink ? 'hover:shadow-md hover:border-primary-300 dark:hover:border-primary-600' : ''}
  `;

  return (
    <div className={cardClasses}>
      {/* Invisible overlay link for the whole card */}
      {hasLink && (
        isExternal ? (
          <a
            href={resource.url!}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute inset-0 z-0"
            aria-label={resource.name}
          />
        ) : (
          <Link
            href={resource.url!}
            className="absolute inset-0 z-0"
            aria-label={resource.name}
          />
        )
      )}

      <div className="relative z-10 pointer-events-none">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold text-gray-900 dark:text-white">
                {resource.name}
              </h4>
              {resource.isRecommended && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300">
                  Recommended
                </span>
              )}
            </div>
            {resource.description && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {renderDescription(resource.description)}
              </p>
            )}
            {resource.subItems && resource.subItems.length > 0 && (
              <ul className="mt-3 space-y-2 border-l-2 border-gray-200 dark:border-gray-600 pl-3">
                {resource.subItems.map((subItem, idx) => (
                  <li key={subItem.name + idx} className="text-sm">
                    {subItem.url ? (
                      <a
                        href={subItem.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-primary-600 dark:text-primary-400 hover:underline pointer-events-auto"
                      >
                        {subItem.name}
                      </a>
                    ) : (
                      <span className="font-medium text-gray-800 dark:text-gray-200">
                        {subItem.name}
                      </span>
                    )}
                    {subItem.description && (
                      <span className="text-gray-600 dark:text-gray-400">
                        {' — '}{renderDescription(subItem.description)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {hasLink && isExternal && (
            <ExternalLink
              className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0 mt-1"
              aria-hidden="true"
            />
          )}
        </div>
        {resource.guideUrl && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <Link
              href={resource.guideUrl}
              className="text-sm text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1.5 pointer-events-auto"
            >
              <BookOpen className="w-4 h-4" aria-hidden="true" />
              View Guide
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
