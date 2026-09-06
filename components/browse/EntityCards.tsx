import { memo } from 'react';
import Link from '@/components/Link';

export interface EntityCardField {
  label: string;
  value: React.ReactNode;
}

interface EntityCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  link?: string;
  fields: EntityCardField[];
  badges?: React.ReactNode;
  rightContent?: React.ReactNode;
}

export const EntityCard = memo(function EntityCard({ title, subtitle, link, fields, badges, rightContent }: EntityCardProps) {
  const titleContent = (
    <div>
      <h3 className="bw-card-title">
        {title}
      </h3>
      {subtitle && (
        <p className="text-xs text-[color:var(--nezu)]">{subtitle}</p>
      )}
    </div>
  );

  return (
    <div className="bw-panel bw-panel--pick w-full md:w-[calc(50%-8px)] lg:w-[calc(33.33%-11px)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {link ? (
            <Link href={link} className="group">
              {titleContent}
            </Link>
          ) : (
            titleContent
          )}

          {/* Fields */}
          <div className="mt-2 space-y-1">
            {fields.map((field) => (
              <div key={field.label} className="flex items-center gap-2 text-xs">
                <span className="bw-label w-20 shrink-0">{field.label}</span>
                <span className="text-[color:var(--text-secondary)]">{field.value}</span>
              </div>
            ))}
          </div>

          {/* Badges */}
          {badges && <div className="mt-2">{badges}</div>}
        </div>

        {/* Right content (e.g., count) */}
        {rightContent && (
          <div className="shrink-0 text-right">
            {rightContent}
          </div>
        )}
      </div>
    </div>
  );
});

interface EntityCardsProps {
  children: React.ReactNode;
  isLoading?: boolean;
  isValidating?: boolean;
  emptyMessage?: string;
  isEmpty?: boolean;
  /** Set when the request did not come back, which is not the same as matching nothing. */
  failed?: boolean;
}

// Pure component, no hooks. SWR's keepPreviousData handles stale data display,
// so we don't need refs to cache previous children.
export function EntityCards({ children, isLoading, isValidating, emptyMessage = 'No results found.', isEmpty, failed }: EntityCardsProps) {
  // Show skeleton on initial load (no data yet)
  if (isLoading) {
    return (
      <div className="flex flex-wrap justify-center gap-4">
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="bw-panel w-full md:w-[calc(50%-8px)] lg:w-[calc(33.33%-11px)] p-4"
          >
            <div className="h-5 rounded-sm w-2/3 mb-2 image-placeholder" />
            <div className="h-3 rounded-sm w-1/2 mb-3 image-placeholder" />
            <div className="space-y-1.5">
              <div className="h-3 rounded-sm w-full image-placeholder" />
              <div className="h-3 rounded-sm w-3/4 image-placeholder" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Show empty state
  // Ahead of the empty state on purpose: an unanswered request would otherwise read as a
  // confident "nothing matched", and the filters are the first thing a reader would blame.
  if (failed) {
    return (
      <div
        role="status"
        className="bw-panel bw-empty"
      >
        These results could not be loaded. The stats service did not answer, which is usually
        brief.
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="bw-panel bw-empty">
        {emptyMessage}
      </div>
    );
  }

  // Show content with opacity transition during revalidation
  return (
    <>
      {/* Each card carries an h3 title and the entity tabs have no other heading between
          them and the page h1, so the list needs one that names the region. Nothing in
          the layout has room for it, so it is exposed to assistive technology only. */}
      <h2 className="sr-only">Results</h2>
      <div
        className="flex flex-wrap justify-center gap-4 transition-opacity duration-150"
        style={{ opacity: isValidating ? 0.6 : 1 }}
      >
        {children}
      </div>
    </>
  );
}
