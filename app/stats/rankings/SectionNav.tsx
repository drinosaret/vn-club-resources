'use client';

import { useEffect, useState } from 'react';

import type { CatalogueSection } from './catalogue-structure';

/**
 * Jump navigation for the catalogue.
 *
 * The page is several screens of similar-looking cards, which is fine to read top to bottom
 * and poor to navigate: there is no way to see what is on it without scrolling all of it.
 * This shows the whole shape at once, with counts, and tracks what is on screen.
 *
 * Two components rather than one responsive element, because a sticky element can only
 * travel within its own parent's box. The rail works as a grid item, which stretches to the
 * height of the content beside it; the strip has to sit outside that grid, directly under a
 * parent tall enough to stick against. Wrapping both in one short container would pin
 * neither.
 */

export interface SectionCount {
  section: CatalogueSection;
  count: number;
}

/** Where a section is considered "reached", as a fraction down the viewport. */
const ACTIVE_LINE = 0.3;

/** The section currently being read, by key. */
function useActiveSection(sections: SectionCount[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const keys = sections.map(({ section }) => section.key).join(',');

  useEffect(() => {
    if (!keys) return;

    const headings = keys
      .split(',')
      .map((key) => document.getElementById(`section-${key}`))
      .filter((element): element is HTMLElement => element !== null);

    if (!headings.length) return;

    // Position rather than intersection: with sections taller than the viewport, several are
    // intersecting at once and the entry order does not say which one is being read.
    const update = () => {
      const line = window.innerHeight * ACTIVE_LINE;
      let current = headings[0].id;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= line) current = heading.id;
      }
      setActive(current.replace('section-', ''));
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [keys]);

  return active;
}

/** Wide viewports: a rail that stays put beside the content. */
export function SectionRail({ sections, total }: { sections: SectionCount[]; total: number }) {
  const active = useActiveSection(sections);
  if (sections.length < 2) return null;

  return (
    <nav aria-label="Ranking categories" className="hidden lg:block">
      <div className="sticky top-24">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          {total} rankings
        </p>
        <ul className="space-y-0.5">
          {sections.map(({ section, count }) => {
            const isActive = active === section.key;
            return (
              <li key={section.key}>
                <a
                  href={`#section-${section.key}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-medium'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <section.Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{section.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                    {count}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/**
 * Narrow viewports: the same list as a strip under the site header.
 *
 * Offset by the header's own height so the two meet without a band of scrolling content
 * showing between them.
 */
export function SectionStrip({ sections }: { sections: SectionCount[] }) {
  const active = useActiveSection(sections);
  if (sections.length < 2) return null;

  return (
    <nav
      aria-label="Ranking categories"
      className="lg:hidden sticky top-[68px] z-20 -mx-4 mb-4 px-4 py-2 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-200/60 dark:border-gray-700/60"
    >
      <ul className="flex gap-1.5 overflow-x-auto">
        {sections.map(({ section, count }) => {
          const isActive = active === section.key;
          return (
            <li key={section.key} className="shrink-0">
              <a
                href={`#section-${section.key}`}
                aria-current={isActive ? 'true' : undefined}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}
              >
                {section.label}
                <span className={`tabular-nums ${isActive ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'}`}>
                  {count}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
