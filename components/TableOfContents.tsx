'use client';

import { useEffect, useState, memo, useMemo } from 'react';
import { generateHeadingId } from '@/lib/slug-utils';

interface TOCItem {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  content: string;
}

export const TableOfContents = memo(function TableOfContents({ content }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');

  // Memoize heading extraction to avoid re-parsing on every render
  const headings = useMemo(() => {
    const lines = content.split('\n');
    const toc: TOCItem[] = [];

    lines.forEach((line) => {
      const cleanLine = line.replace(/\r/g, '').trim();
      const match = cleanLine.match(/^(#{2,4})\s*(.+)$/);
      if (match) {
        const level = match[1].length;
        let text = match[2].trim();
        text = text.replace(/\*\*/g, '');
        text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        const id = generateHeadingId(text);
        toc.push({ id, text, level });
      }
    });

    return toc;
  }, [content]);

  // IntersectionObserver for active heading tracking
  useEffect(() => {
    if (headings.length === 0) return;

    const visibleHeadings = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            visibleHeadings.add(entry.target.id);
          } else {
            visibleHeadings.delete(entry.target.id);
          }
        });

        if (visibleHeadings.size > 0) {
          // Find the topmost visible heading in document order
          const topmostHeading = headings.find((h) => visibleHeadings.has(h.id));
          if (topmostHeading) {
            setActiveId(topmostHeading.id);
            // Update URL hash without triggering scroll
            const newHash = `#${topmostHeading.id}`;
            if (window.location.hash !== newHash) {
              history.replaceState(null, '', newHash);
            }
          }
        }
      },
      { rootMargin: '-80px 0px -40% 0px' }
    );

    const elements = headings.map((h) => document.getElementById(h.id)).filter(Boolean) as Element[];
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [headings]);

  // Initialize activeId from URL hash or first heading
  useEffect(() => {
    if (headings.length === 0) return;

    if (window.location.hash) {
      const hash = window.location.hash.slice(1);
      if (headings.some(h => h.id === hash)) {
        setActiveId(hash);
        return;
      }
    }
    setActiveId(headings[0].id);
    // Set initial hash to first heading for consistency
    history.replaceState(null, '', `#${headings[0].id}`);
  }, [headings]);

  if (headings.length === 0) {
    return (
      <nav className="sticky top-24 z-10">
        <div className="border-l-2 border-gray-200 dark:border-gray-700 pl-4">
          <h3 className="font-semibold text-xs uppercase tracking-wide text-gray-700 dark:text-gray-300 mb-4">
            On This Page
          </h3>
          <p className="text-xs text-gray-500">Loading...</p>
        </div>
      </nav>
    );
  }

  return (
    <nav className="sticky top-24 z-10 max-h-[calc(100vh-8rem)] overflow-y-auto">
      <div className="border-l-2 border-gray-200 dark:border-gray-700 pl-4">
        <h3 className="font-semibold text-xs uppercase tracking-wide text-gray-700 dark:text-gray-300 mb-4">
          On This Page
        </h3>
        <ul className="space-y-2.5 text-sm">
          {headings.map((heading) => (
            <li
              key={heading.id}
              style={{ paddingLeft: `${(heading.level - 2) * 0.75}rem` }}
            >
              <a
                href={`#${heading.id}`}
                onClick={() => setActiveId(heading.id)}
                className={`block py-0.5 transition-colors leading-snug ${
                  activeId === heading.id
                    ? 'text-indigo-600 dark:text-indigo-400 font-medium'
                    : 'text-gray-800 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
});
