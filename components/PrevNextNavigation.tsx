import Link from '@/components/Link';
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
      className="mt-12 pt-8 border-t border-[color:var(--rule)]"
      aria-label="Page navigation"
    >
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        {/* Previous Page */}
        {prevPage ? (
          <Link
            href={prevPage.slug === '' ? '/' : `/${prevPage.slug}`}
            className="group flex-1 flex items-center gap-3 p-4 rounded-xs border border-[color:var(--rule)] hover:border-[color:var(--kohaku)] transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-[color:var(--nezu)] group-hover:text-[color:var(--ai)] transition-colors shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="font-mono text-xs uppercase tracking-wide text-[color:var(--nezu)]">
                Previous
              </span>
              <span className="font-medium text-[color:var(--ink)] group-hover:text-[color:var(--ai)] transition-colors truncate">
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
            className="group flex-1 flex items-center justify-end gap-3 p-4 rounded-xs border border-[color:var(--rule)] hover:border-[color:var(--kohaku)] transition-colors text-right"
          >
            <div className="flex flex-col min-w-0">
              <span className="font-mono text-xs uppercase tracking-wide text-[color:var(--nezu)]">
                Next
              </span>
              <span className="font-medium text-[color:var(--ink)] group-hover:text-[color:var(--ai)] transition-colors truncate">
                {nextPage.title}
              </span>
            </div>
            <ChevronRight className="w-5 h-5 text-[color:var(--nezu)] group-hover:text-[color:var(--ai)] transition-colors shrink-0" />
          </Link>
        ) : (
          <div className="flex-1" />
        )}
      </div>
    </nav>
  );
}
