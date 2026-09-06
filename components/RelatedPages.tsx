import Link from '@/components/Link';
import { BookOpen, Link as LinkIcon } from 'lucide-react';
import type { RelatedCategory } from '@/lib/resource-parser';

interface RelatedPagesProps {
  categories: RelatedCategory[];
}

export function RelatedPages({ categories }: RelatedPagesProps) {
  return (
    <section className="mt-12 pt-8 border-t border-[color:var(--rule)]">
      <h2 id="related-pages" className="sec-title group flex items-center gap-2 mb-6">
        <BookOpen className="w-6 h-6 text-[color:var(--nezu)]" />
        Related Pages
        <a
          href="#related-pages"
          className="sw-icon ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Permanent link"
          aria-label="Link to this section"
        >
          <LinkIcon className="inline h-4 w-4" />
        </a>
      </h2>

      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {categories.map((category, idx) => (
          <div
            key={category.title + idx}
            className="sw-panel p-4"
          >
            <h3 className="sw-plate mb-3">
              {category.title}
            </h3>
            <ul className="space-y-2">
              {category.links.map((link, linkIdx) => (
                <li key={link.url + linkIdx}>
                  <Link
                    href={link.url}
                    className="sw-pick -mx-2 px-2 py-1.5"
                  >
                    <span className="sw-pick-name text-sm">
                      {link.text}
                    </span>
                    {link.description && (
                      <span className="sw-pick-desc mt-0.5 line-clamp-2">
                        {link.description}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
