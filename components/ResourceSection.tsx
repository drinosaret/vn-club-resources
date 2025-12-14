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
        className="text-2xl font-bold mt-12 mb-6 pb-3 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white"
      >
        {section.title}
      </h2>

      {section.description && (
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {section.description}
        </p>
      )}

      {section.subsections.map((subsection, idx) => (
        <div key={subsection.id + idx} className="mb-8">
          {subsection.title && (
            <h3
              id={subsection.id}
              className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200"
            >
              {subsection.title}
            </h3>
          )}
          {subsection.description && (
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              {subsection.description}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
            {subsection.items.map((item, itemIdx) => (
              <ResourceCard key={item.name + itemIdx} resource={item} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
