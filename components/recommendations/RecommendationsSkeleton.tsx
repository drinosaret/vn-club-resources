'use client';

import { ResultLayout } from '@/lib/recommendation-layout';

import { LAYOUT_CONTAINER_CLASS } from './RecommendationResult';

/**
 * The shape of an answer that has not arrived.
 *
 * It sits on the container the results will sit on, taken from the same table they take it
 * from, because a placeholder on a different grid becomes a jump at the moment the answer
 * lands. The counts are roughly a screenful of each layout, so the two have the same weight.
 */

const SKELETON_COUNTS: Record<ResultLayout, number> = {
  list: 12,
  grid: 18,
  cards: 20,
  detail: 6,
};

export function RecommendationsSkeleton({ layout }: { layout: ResultLayout }) {
  const items = Array.from({ length: SKELETON_COUNTS[layout] });
  const containerClass = LAYOUT_CONTAINER_CLASS[layout];

  if (layout === 'list') {
    return (
      <ol className={containerClass}>
        {items.map((_, i) => (
          <li key={i} className="rc-row">
            <div className="rc-ghost shrink-0 w-7 h-4" />
            <div className="rc-art shrink-0 w-8 h-11">
              <div className="w-full h-full image-placeholder" />
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="rc-ghost h-3 w-2/3" />
              <div className="rc-ghost h-2.5 w-1/2" />
            </div>
            <div className="rc-ghost shrink-0 h-3 w-8" />
          </li>
        ))}
      </ol>
    );
  }

  if (layout === 'detail') {
    return (
      <div className={containerClass}>
        {items.map((_, i) => (
          <div key={i} className="rc-card rc-card--row gap-3 sm:gap-4 p-3">
            <div className="rc-art shrink-0 w-[96px] sm:w-[120px] aspect-3/4">
              <div className="w-full h-full image-placeholder" />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="rc-ghost h-3 w-1/3" />
              <div className="rc-ghost h-3.5 w-4/5" />
              <div className="space-y-1 pt-1">
                <div className="rc-ghost h-2.5 w-full" />
                <div className="rc-ghost h-2.5 w-full" />
                <div className="rc-ghost h-2.5 w-3/5" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const dense = layout === 'grid';

  return (
    <div className={containerClass}>
      {items.map((_, i) => (
        <div key={i} className={dense ? '' : 'rc-card'}>
          <div className="rc-art aspect-3/4">
            <div className="absolute inset-0 image-placeholder" />
            <div className="rc-ghost absolute top-2 left-2 w-8 h-5" />
            <div className="rc-ghost absolute top-2 right-2 w-10 h-5" />
          </div>
          {dense ? (
            <div className="mt-1 space-y-1">
              <div className="rc-ghost h-2.5 w-full" />
              <div className="rc-ghost h-2.5 w-2/3" />
            </div>
          ) : (
            <div className="p-2 space-y-1.5">
              <div className="rc-ghost h-3 w-full" />
              <div className="rc-ghost h-3 w-2/3" />
              <div className="rc-ghost h-2.5 w-1/2" />
              <div className="rc-ghost h-2.5 w-5/6" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
