'use client';

/**
 * Skeleton loading state for VN detail page during SSR.
 * Matches the layout of VNDetailClient for smooth transition.
 */
export function VNDetailSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-4 pt-8">
      {/* Header skeleton */}
      <div className="flex items-center justify-between gap-2 mb-6">
        <div className="w-20 h-10 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
        <div className="flex items-center gap-2">
          <div className="w-32 h-10 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
          <div className="w-24 h-10 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
        {/* Cover skeleton */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="aspect-[3/4] max-w-[280px] mx-auto lg:mx-0 rounded-xl image-placeholder" />
        </div>

        {/* Content skeleton */}
        <div className="space-y-6">
          {/* Title section */}
          <div>
            <div className="w-3/4 h-8 rounded mb-2 bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="w-1/2 h-6 rounded mb-4 bg-gray-200 dark:bg-gray-700 animate-pulse" />
          </div>

          {/* Metadata grid skeleton */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="space-y-1">
                <div className="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                <div className="h-5 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              </div>
            ))}
          </div>

          {/* Tab bar skeleton */}
          <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
            {['Summary', 'Tags', 'Traits', 'Characters'].map((tab) => (
              <div
                key={tab}
                className="h-10 px-4 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"
                style={{ width: `${tab.length * 10 + 32}px` }}
              />
            ))}
          </div>

          {/* Content area skeleton */}
          <div className="space-y-6">
            {/* Description skeleton */}
            <div className="space-y-2">
              <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              <div className="h-4 w-3/4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              <div className="h-4 w-5/6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            </div>

            {/* Tags skeleton */}
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div
                  key={i}
                  className="h-7 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse"
                  style={{ width: `${60 + (i % 3) * 20}px` }}
                />
              ))}
            </div>

            {/* Similar VNs skeleton */}
            <div className="space-y-3">
              <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i}>
                    <div className="aspect-[3/4] rounded-lg image-placeholder" />
                    <div className="mt-1.5 space-y-1">
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
