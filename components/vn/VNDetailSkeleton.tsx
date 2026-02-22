/**
 * Skeleton loading state for VN detail page.
 * Matches the layout of VNDetailClient for smooth transition.
 * Uses image-placeholder (background-color animation) instead of animate-pulse
 * (opacity animation) to avoid creating compositor layers in Firefox.
 */
export function VNDetailSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-4 pt-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-4">
        <div className="w-16 h-8 rounded-lg image-placeholder" />
        <div className="flex items-center gap-2">
          <div className="w-28 h-9 rounded-lg image-placeholder" />
          <div className="w-20 h-9 rounded-lg image-placeholder" />
        </div>
      </div>

      {/* Title skeleton */}
      <div className="mb-4">
        <div className="w-3/4 h-7 rounded-sm image-placeholder" />
        <div className="w-1/2 h-5 rounded-sm image-placeholder mt-1.5" />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 lg:gap-8">
        {/* Left column: cover + sidebar */}
        <div>
          <div className="aspect-3/4 max-w-[280px] mx-auto lg:mx-0 rounded-xl image-placeholder" />
          {/* Sidebar skeleton */}
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-[52px] h-[52px] rounded-full image-placeholder" />
              <div className="space-y-1">
                <div className="w-20 h-3.5 rounded-sm image-placeholder" />
                <div className="w-16 h-3 rounded-sm image-placeholder" />
              </div>
            </div>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i}>
                <div className="w-16 h-3 rounded-sm image-placeholder mb-1" />
                <div className="h-4 rounded-sm image-placeholder" style={{ width: `${60 + i * 15}px` }} />
              </div>
            ))}
          </div>
        </div>

        {/* Right column: description + tabs + content */}
        <div className="space-y-4">
          {/* Description skeleton */}
          <div className="space-y-2">
            <div className="h-4 w-full rounded-sm image-placeholder" />
            <div className="h-4 w-full rounded-sm image-placeholder" />
            <div className="h-4 w-3/4 rounded-sm image-placeholder" />
          </div>

          {/* Tab bar skeleton */}
          <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 pb-1">
            {['Overview', 'Stats', 'Language', 'Tags', 'Traits', 'Characters'].map((tab) => (
              <div
                key={tab}
                className="h-7 rounded-lg image-placeholder"
                style={{ width: `${tab.length * 9 + 24}px` }}
              />
            ))}
          </div>

          {/* Tags skeleton */}
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div
                key={i}
                className="h-6 rounded-full image-placeholder"
                style={{ width: `${55 + (i % 3) * 18}px` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
