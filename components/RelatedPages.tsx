import Link from 'next/link';
import { ArrowRight, BookOpen, Link as LinkIcon } from 'lucide-react';
import type { RelatedCategory } from '@/lib/resource-parser';

interface RelatedPagesProps {
  categories: RelatedCategory[];
}

export function RelatedPages({ categories }: RelatedPagesProps) {
  return (
    <section className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
      <h2 id="related-pages" className="group text-2xl font-bold mb-6 flex items-center gap-2 text-gray-900 dark:text-white">
        <BookOpen className="w-6 h-6 text-primary-500" />
        Related Pages
        <a
          href="#related-pages"
          className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
            className="rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-4"
          >
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 text-sm uppercase tracking-wide">
              {category.title}
            </h3>
            <ul className="space-y-2">
              {category.links.map((link, linkIdx) => (
                <li key={link.url + linkIdx}>
                  <Link
                    href={link.url}
                    className="group flex items-start gap-2 text-sm hover:bg-white dark:hover:bg-gray-800 -mx-2 px-2 py-1.5 rounded-lg transition-colors"
                  >
                    <ArrowRight className="w-4 h-4 mt-0.5 text-primary-500 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-primary-600 dark:text-primary-400 group-hover:underline">
                        {link.text}
                      </span>
                      {link.description && (
                        <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5 line-clamp-2">
                          {link.description}
                        </p>
                      )}
                    </div>
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
