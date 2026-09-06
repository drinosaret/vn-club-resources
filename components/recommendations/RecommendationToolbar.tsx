'use client';

import { SlidersHorizontal } from 'lucide-react';

/**
 * The row that sits directly over the results.
 *
 * Which tab is open decides what the order below means, so the strip belongs here rather than
 * among the filters, and the row carrying it is the one that has to stay reachable. It sticks
 * because the control saying that edits have not been applied is only useful where the reading
 * happens, and by then the reader is somewhere down the list.
 *
 * The strip arrives as children: nothing here needs to know which lists exist.
 */

interface RecommendationToolbarProps {
  children: React.ReactNode;
  filtersPanelId: string;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  /** Filters in force on the list being shown, which is what the badge counts. */
  activeFilterCount: number;
  hasPendingChanges: boolean;
  /** A request raised by Apply, as distinct from one raised by opening a tab. */
  isApplying: boolean;
  onApply: () => void;
}

export function RecommendationToolbar({
  children,
  filtersPanelId,
  filtersOpen,
  onToggleFilters,
  triggerRef,
  activeFilterCount,
  hasPendingChanges,
  isApplying,
  onApply,
}: RecommendationToolbarProps) {
  const updateButton = (
    <button type="button" onClick={onApply} disabled={isApplying} className="rc-btn rc-btn--go">
      {isApplying && <span aria-hidden className="rc-spin w-2.5 h-2.5" />}
      {isApplying ? 'Updating' : 'Update results'}
    </button>
  );

  return (
    <div className="rc-bar pt-3 pb-2 mb-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          ref={triggerRef}
          onClick={onToggleFilters}
          aria-expanded={filtersOpen}
          aria-controls={filtersPanelId}
          className={`rc-btn rc-btn--filter shrink-0 ${filtersOpen ? 'rc-btn--go' : ''}`}
        >
          <SlidersHorizontal aria-hidden className="w-3.5 h-3.5" />
          Filters
          {activeFilterCount > 0 && <span className="rc-badge">{activeFilterCount}</span>}
          {/* An edit waiting to be applied raises no count of its own, so it is marked. */}
          {hasPendingChanges && activeFilterCount === 0 && <span aria-hidden className="rc-dot" />}
        </button>

        <div className="flex-1 min-w-0">{children}</div>

        {hasPendingChanges && <div className="hidden sm:block shrink-0">{updateButton}</div>}
      </div>

      {/* Below the narrow breakpoint the button takes its own line rather than the width the
          tab strip needs, at the one moment a large target with words on it is wanted. */}
      {hasPendingChanges && <div className="sm:hidden mt-2">{updateButton}</div>}

      {/* Mounted in every state, so opening and closing the panel changes what is visible
          without changing what is said, and the announcement follows an edit rather than a
          disclosure. */}
      <p
        role="status"
        className={hasPendingChanges && !filtersOpen ? 'rc-why rc-caution mt-1.5' : 'sr-only'}
      >
        {isApplying
          ? 'Updating the list to match your settings.'
          : hasPendingChanges
            ? 'The list below still reflects your previous settings.'
            : ''}
      </p>
    </div>
  );
}
