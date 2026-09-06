'use client';

import { useEffect, useRef } from 'react';

import { ListName, RecommendationList } from '@/lib/recommendation-weights';

interface RecommendationListTabsProps {
  lists: RecommendationList[];
  active: ListName;
  onChange: (list: ListName) => void;
  /** Lists whose answer is already held, so a tab can say it will not have to fetch. */
  loaded: ReadonlySet<ListName>;
  /** The list a request is in flight for, or null. */
  pending: ListName | null;
  /**
   * How the strip fills its space. It wraps where it has a column to itself, and scrolls
   * where it shares a row with other controls and would otherwise push them off it.
   */
  layout?: 'wrap' | 'scroll';
}

/**
 * The nine lists as a tab strip.
 *
 * Each list is one signal's own ranking, so the strip is the page's main control rather
 * than a view switch: which tab is open decides what the order means. The combined list
 * leads because it is the only one built from all of them.
 *
 * Nothing here fetches. The page fetches a list the first time its tab is opened and holds
 * the answer, which is why the strip marks what it already has: only the combined list is
 * served from the nightly copy, and every other tab costs a few seconds the first time.
 */
export function RecommendationListTabs({
  lists,
  active,
  onChange,
  loaded,
  pending,
  layout = 'wrap',
}: RecommendationListTabsProps) {
  const tabRefs = useRef<Map<ListName, HTMLButtonElement>>(new Map());
  const stripRef = useRef<HTMLDivElement>(null);

  // Set on the strip rather than by scrolling the element into view, which would also move
  // the page and take the row out from under the reader.
  //
  // The tab's position is measured against the strip itself. An offset read from the layout
  // tree is relative to whichever ancestor happens to be positioned, and the strip shares its
  // row with a control that sits outside it, so that offset carries a head start the strip
  // knows nothing about and the row opens already scrolled.
  useEffect(() => {
    if (layout !== 'scroll') return;
    const strip = stripRef.current;
    const tab = tabRefs.current.get(active);
    if (!strip || !tab) return;
    const stripBox = strip.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    const withinStrip = tabBox.left - stripBox.left + strip.scrollLeft;
    strip.scrollLeft = Math.max(0, withinStrip - (strip.clientWidth - tabBox.width) / 2);
  }, [active, layout]);

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % lists.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + lists.length) % lists.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = lists.length - 1;
    if (next < 0) return;

    event.preventDefault();
    const target = lists[next];
    onChange(target.name);
    tabRefs.current.get(target.name)?.focus();
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Recommendation lists"
      className={layout === 'scroll' ? 'tabs rc-tabs-scroll scrollbar-thin' : 'tabs justify-center'}
    >
      {lists.map((list, index) => {
        const isActive = list.name === active;
        const isPending = pending === list.name;
        return (
          <button
            key={list.name}
            ref={(element) => {
              if (element) tabRefs.current.set(list.name, element);
            }}
            type="button"
            role="tab"
            id={`rec-list-tab-${list.name}`}
            aria-selected={isActive}
            aria-controls="rec-list-panel"
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(list.name)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            title={list.blurb}
            className={`tab ${isActive ? 'tab--on' : ''}`}
          >
            {list.label}
            {isPending ? (
              <span aria-hidden className="rc-spin w-2.5 h-2.5" />
            ) : (
              /* A mark for a list already held, so the cost of opening a tab is visible
                 before it is paid rather than after. */
              !isActive && loaded.has(list.name) && <span aria-hidden className="rc-dot" />
            )}
          </button>
        );
      })}
    </div>
  );
}
