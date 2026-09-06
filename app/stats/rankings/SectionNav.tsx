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
        <p className="fig-label pb-2">{total} rankings</p>
        <ul className="tabs flex-col">
          {sections.map(({ section, count }) => {
            const isActive = active === section.key;
            return (
              <li key={section.key}>
                <a
                  href={`#section-${section.key}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={`tab w-full justify-between ${isActive ? 'tab--on' : ''}`}
                >
                  <span className="min-w-0 flex-1 truncate text-left">{section.label}</span>
                  <span className="tab-count">{count}</span>
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
      className="sticky top-[68px] z-20 -mx-4 mb-4 border-b border-[color:var(--rule)] bg-[color:var(--surface)] px-4 py-2 lg:hidden"
    >
      <ul className="tabs rc-tabs-scroll">
        {sections.map(({ section, count }) => {
          const isActive = active === section.key;
          return (
            <li key={section.key} className="shrink-0">
              <a
                href={`#section-${section.key}`}
                aria-current={isActive ? 'true' : undefined}
                className={`tab ${isActive ? 'tab--on' : ''}`}
              >
                {section.label}
                <span className="tab-count">{count}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
