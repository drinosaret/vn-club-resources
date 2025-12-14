'use client';

import { useEffect, useState, memo, useMemo } from 'react';

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
    // Extract headings from markdown content
    const lines = content.split('\n');
    const toc: TOCItem[] = [];
    
    lines.forEach((line) => {
      // Remove carriage returns and trim
      const cleanLine = line.replace(/\r/g, '').trim();
      
      // Match headings (## heading or ###heading)
      const match = cleanLine.match(/^(#{2,4})\s*(.+)$/);
      if (match) {
        const level = match[1].length;
        let text = match[2].trim();
        
        // Clean up the text
        text = text.replace(/\*\*/g, ''); // Remove bold markers
        text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // Remove links
        
        const id = text
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-');
        
        toc.push({ id, text, level });
      }
    });
    
    return toc;
  }, [content]);

  useEffect(() => {
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: '-100px 0px -80% 0px' }
    );

    const elements = headings.map((h) => document.getElementById(h.id)).filter(Boolean) as Element[];
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [headings]);

  // Update URL hash when active heading changes (MkDocs-style behavior)
  useEffect(() => {
    if (!activeId) return;

    // Use replaceState to update URL without adding to browser history
    // This prevents cluttering the back button with every scroll
    const newUrl = `${window.location.pathname}${window.location.search}#${activeId}`;
    window.history.replaceState(null, '', newUrl);
  }, [activeId]);

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
