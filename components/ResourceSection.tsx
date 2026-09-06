import { Link } from 'lucide-react';
import { ResourceCard } from './ResourceCard';
import type { ResourceSection as ResourceSectionType } from '@/lib/resource-parser';

interface ResourceSectionProps {
  section: ResourceSectionType;
}

export function ResourceSection({ section }: ResourceSectionProps) {
  return (
    <section className="mb-12">
      <h2
        id={section.id}
        className="group font-display text-2xl font-bold mt-12 mb-6 pb-3 border-b border-[color:var(--rule)] text-[color:var(--ink)]"
      >
        {section.title}
        <a
          href={`#${section.id}`}
          className="md-anchor"
          title="Permanent link"
          aria-label="Link to this section"
        >
          <Link className="inline h-4 w-4" />
        </a>
      </h2>

      {section.description && (
        <p className="text-[color:var(--nezu)] mb-6">
          {section.description}
        </p>
      )}

      {section.subsections.map((subsection, idx) => (
        <div key={subsection.id + idx} className="mb-8">
          {subsection.title && (
            <h3
              id={subsection.id}
              className="group font-display text-lg font-semibold mb-4 text-[color:var(--ink)]"
            >
              {subsection.title}
              <a
                href={`#${subsection.id}`}
                className="md-anchor"
                title="Permanent link"
                aria-label="Link to this section"
              >
                <Link className="inline h-4 w-4" />
              </a>
            </h3>
          )}
          {subsection.description && (
            <p className="text-[color:var(--nezu)] mb-4">
              {subsection.description}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
            {subsection.items.map((item, itemIdx) => (
              <ResourceCard
                key={item.name + itemIdx}
                resource={item}
                headingLevel={subsection.title ? 4 : 3}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
