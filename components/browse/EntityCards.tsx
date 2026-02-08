import { memo } from 'react';
import Link from 'next/link';

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
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
        {title}
      </h3>
      {subtitle && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
      )}
    </div>
  );

  return (
    <div className="w-full md:w-[calc(50%-8px)] lg:w-[calc(33.33%-11px)] bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-primary-300 dark:hover:border-primary-700 transition-colors">
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
                <span className="text-gray-400 dark:text-gray-500 w-20 flex-shrink-0">{field.label}:</span>
                <span className="text-gray-700 dark:text-gray-300">{field.value}</span>
              </div>
            ))}
          </div>

          {/* Badges */}
          {badges && <div className="mt-2">{badges}</div>}
        </div>

        {/* Right content (e.g., count) */}
        {rightContent && (
          <div className="flex-shrink-0 text-right">
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
}

// Pure component — no hooks. SWR's keepPreviousData handles stale data display,
// so we don't need refs to cache previous children.
export function EntityCards({ children, isLoading, isValidating, emptyMessage = 'No results found.', isEmpty }: EntityCardsProps) {
  // Show skeleton on initial load (no data yet)
  if (isLoading) {
    return (
      <div className="flex flex-wrap justify-center gap-4">
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="w-full md:w-[calc(50%-8px)] lg:w-[calc(33.33%-11px)] bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
          >
            <div className="h-5 rounded w-2/3 mb-2 image-placeholder" />
            <div className="h-3 rounded w-1/2 mb-3 image-placeholder" />
            <div className="space-y-1.5">
              <div className="h-3 rounded w-full image-placeholder" />
              <div className="h-3 rounded w-3/4 image-placeholder" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Show empty state
  if (isEmpty) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
        {emptyMessage}
      </div>
    );
  }

  // Show content with opacity transition during revalidation
  return (
    <div
      className="flex flex-wrap justify-center gap-4 transition-opacity duration-150"
      style={{ opacity: isValidating ? 0.6 : 1 }}
    >
      {children}
    </div>
  );
}
