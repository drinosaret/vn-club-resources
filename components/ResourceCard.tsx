import type { ReactElement } from 'react';
import Link from '@/components/Link';
import { ExternalLink, BookOpen } from 'lucide-react';
import type { ResourceItem } from '@/lib/resource-parser';

interface ResourceCardProps {
  resource: ResourceItem;
  // A subsection heading is optional, so the card sits one level below whichever
  // heading actually precedes it rather than at a fixed depth.
  headingLevel?: 3 | 4;
}

// Render description with inline links parsed from markdown
function renderDescription(description: string) {
  // Match markdown links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: (string | ReactElement)[] = [];
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
          className="text-[color:var(--ai)] hover:underline pointer-events-auto"
        >
          {text}
        </a>
      );
    } else {
      parts.push(
        <Link
          key={match.index}
          href={url}
          className="text-[color:var(--ai)] hover:underline pointer-events-auto"
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

export function ResourceCard({ resource, headingLevel = 4 }: ResourceCardProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const isExternal = resource.url?.startsWith('http');
  const hasLink = !!resource.url;

  // A card is its rule, so the rule is what moves when it is a target.
  const cardClasses = `
    relative rounded-xs bg-[color:var(--surface)]
    border border-[color:var(--rule)]
    p-5 transition-colors duration-200
    ${hasLink ? 'hover:border-[color:var(--kohaku)]' : ''}
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
              <Heading className="font-display font-semibold text-[color:var(--ink)]">
                {resource.name}
              </Heading>
              {resource.isRecommended && (
                <span className="nameplate">
                  Recommended
                </span>
              )}
            </div>
            {resource.description && (
              <p className="mt-2 text-sm text-[color:var(--nezu)] leading-relaxed">
                {renderDescription(resource.description)}
              </p>
            )}
            {resource.subItems && resource.subItems.length > 0 && (
              <ul className="mt-3 space-y-2 border-l border-[color:var(--rule)] pl-3">
                {resource.subItems.map((subItem, idx) => (
                  <li key={subItem.name + idx} className="text-sm">
                    {subItem.url ? (
                      <a
                        href={subItem.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[color:var(--ai)] hover:underline pointer-events-auto"
                      >
                        {subItem.name}
                      </a>
                    ) : (
                      <span className="font-medium text-[color:var(--ink)]">
                        {subItem.name}
                      </span>
                    )}
                    {subItem.description && (
                      <span className="text-[color:var(--nezu)]">
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
              className="w-4 h-4 text-[color:var(--text-faint)] shrink-0 mt-1"
              aria-hidden="true"
            />
          )}
        </div>
        {resource.guideUrl && (
          <div className="mt-3 pt-3 border-t border-[color:var(--rule)]">
            <Link
              href={resource.guideUrl}
              className="text-sm text-[color:var(--ai)] hover:underline flex items-center gap-1.5 pointer-events-auto"
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
