import { Fragment } from 'react';

const URL_REGEX = /https?:\/\/[^\s<>)"']+/g;

/** Renders text with URLs converted to clickable links */
export function LinkifiedText({ text }: { text: string }) {
  const parts: (string | { url: string; display: string })[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_REGEX)) {
    const url = match[0];
    const index = match.index!;

    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index));
    }

    // Show shortened display text for long URLs
    let display: string;
    try {
      const parsed = new URL(url);
      display = parsed.hostname + (parsed.pathname.length > 1 ? parsed.pathname.slice(0, 20) + (parsed.pathname.length > 20 ? '...' : '') : '');
    } catch {
      display = url.length > 40 ? url.slice(0, 40) + '...' : url;
    }

    parts.push({ url, display });
    lastIndex = index + url.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // No URLs found — return plain text
  if (parts.length === 1 && typeof parts[0] === 'string') {
    return <>{text}</>;
  }

  return (
    <>
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          <Fragment key={i}>{part}</Fragment>
        ) : (
          <a
            key={i}
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {part.display}
          </a>
        )
      )}
    </>
  );
}
