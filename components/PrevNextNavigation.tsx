import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getPrevNextPages } from '@/lib/navigation';

interface PrevNextNavigationProps {
  currentSlug: string;
}

export function PrevNextNavigation({ currentSlug }: PrevNextNavigationProps) {
  const { prev: prevPage, next: nextPage } = getPrevNextPages(currentSlug);

  if (!prevPage && !nextPage) {
    return null;
  }

  return (
    <nav
      className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-800"
      aria-label="Page navigation"
    >
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        {/* Previous Page */}
        {prevPage ? (
          <Link
            href={prevPage.slug === '' ? '/' : `/${prevPage.slug}`}
            className="group flex-1 flex items-center gap-3 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-400 group-hover:text-indigo-500 transition-colors flex-shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Previous
              </span>
              <span className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                {prevPage.title}
              </span>
            </div>
          </Link>
        ) : (
          <div className="flex-1" />
        )}

        {/* Next Page */}
        {nextPage ? (
          <Link
            href={nextPage.slug === '' ? '/' : `/${nextPage.slug}`}
            className="group flex-1 flex items-center justify-end gap-3 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors text-right"
          >
            <div className="flex flex-col min-w-0">
              <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Next
              </span>
              <span className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                {nextPage.title}
              </span>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-indigo-500 transition-colors flex-shrink-0" />
          </Link>
        ) : (
          <div className="flex-1" />
        )}
      </div>
    </nav>
  );
}
