'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * The filters, in a drawer along the right edge.
 *
 * Wide enough for the drawer to sit beside the list it edits, it behaves as a drawer:
 * nothing here reaches the list until Apply, so the list being changed stays visible and
 * usable while the change is composed. That means no focus trap, no scroll lock, and no
 * dismissal on an outside click, which would throw away a reader's place in a long panel of
 * edits they had not finished. It scrolls on its own so the whole of it is reachable
 * without moving the page under it.
 *
 * Narrower than that the drawer is the width of the screen and the list is behind it rather
 * than beside it, so for as long as that holds it is a dialog instead: the page underneath
 * leaves the tab order and the accessibility tree, stops scrolling, and focus stays within
 * the drawer, since a focus ring out on the covered page would be invisible.
 *
 * It stays mounted and is hidden rather than removed. The controls inside decide once, at
 * mount, whether to open themselves from what the address carried; unmounting would put them
 * through that decision again every time the panel was reopened. `display: none` takes the
 * subtree out of the accessibility tree and out of hit testing, so nothing inside is reachable
 * while it is shut.
 */

/** The width at which the drawer stops covering the list, matching `.rc-drawer`. */
const SIDE_BY_SIDE = '(min-width: 640px)';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface RecommendationFilterPanelProps {
  id: string;
  open: boolean;
  onClose: () => void;
  onApply: () => void;
  hasPendingChanges: boolean;
  /** Filters in force, for the header; and the way to drop them all at once. */
  activeCount: number;
  onClear: () => void;
  children: React.ReactNode;
}

export function RecommendationFilterPanel({
  id,
  open,
  onClose,
  onApply,
  hasPendingChanges,
  activeCount,
  onClear,
  children,
}: RecommendationFilterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [coversPage, setCoversPage] = useState(false);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // Read in an effect rather than during render, so the server markup and the first client
  // paint agree, and tracked while open so a rotation or a resize switches behaviour.
  useEffect(() => {
    if (!open) {
      setCoversPage(false);
      return;
    }
    const query = window.matchMedia(SIDE_BY_SIDE);
    const sync = () => setCoversPage(!query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [open]);

  // The panel is a descendant of the page rather than a portal into the body, so what has
  // to be shut off is every other child of every ancestor it hangs from. Only elements this
  // marks are unmarked again, leaving anything another layer had already put beyond reach.
  // Part of what is on the page behind answers to the same settings the controls in here
  // edit, so a sibling can appear while the panel is up and is marked as it arrives.
  const releaseInert = useRef(() => {});

  useEffect(() => {
    if (!open || !coversPage) return;
    const panel = panelRef.current;
    if (!panel) return;

    const path = new Set<Element>();
    const parents: Element[] = [];
    let node: Element = panel;
    while (node !== document.body) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) break;
      path.add(node);
      parents.push(parent);
      node = parent;
    }

    const marked: Element[] = [];
    const mark = (element: Element) => {
      if (path.has(element) || element.hasAttribute('inert')) return;
      element.setAttribute('inert', '');
      marked.push(element);
    };
    for (const parent of parents) {
      for (const child of Array.from(parent.children)) mark(child);
    }

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((added) => {
          if (added instanceof Element) mark(added);
        });
      }
    });
    for (const parent of parents) observer.observe(parent, { childList: true });

    // Closing hands focus back to a control out on the page, and an inert element cannot
    // take focus, so the page is given back before the caller is told, rather than in the
    // cleanup that runs a commit later.
    const release = () => {
      observer.disconnect();
      marked.forEach((element) => element.removeAttribute('inert'));
      marked.length = 0;
    };
    releaseInert.current = release;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      release();
      releaseInert.current = () => {};
      document.body.style.overflow = previousOverflow;
    };
  }, [open, coversPage]);

  const handleClose = () => {
    releaseInert.current();
    onClose();
  };

  const handleApply = () => {
    releaseInert.current();
    onApply();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // A control with a list of its own answers Escape first and marks it handled, so
    // dismissing an autocomplete does not also close everything around it.
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      handleClose();
      return;
    }
    if (event.key !== 'Tab' || !coversPage || !panelRef.current) return;
    // A collapsed section's controls are in the markup but cannot take focus, so the ends
    // of the tab order are the ones that are actually drawn.
    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((node) => node.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      id={id}
      ref={panelRef}
      role={coversPage ? 'dialog' : 'region'}
      aria-modal={coversPage || undefined}
      aria-label="Filters and ranking"
      tabIndex={-1}
      hidden={!open}
      onKeyDown={handleKeyDown}
      className="rc-drawer focus:outline-hidden"
    >
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[color:var(--rule)] shrink-0">
        <span className="rc-label inline-flex items-center gap-2">
          Filters
          {activeCount > 0 && <span className="rc-badge">{activeCount}</span>}
        </span>
        {activeCount > 0 && (
          <button type="button" onClick={onClear} className="rc-btn ml-auto">
            Clear filters
          </button>
        )}
        <button
          type="button"
          onClick={handleClose}
          className={`rc-btn rc-btn--icon ${activeCount > 0 ? '' : 'ml-auto'}`}
          aria-label="Close filters"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* The lists the controls open are positioned inside this scroller, so one that opens
          near the bottom is reached by scrolling rather than lost past the edge. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">{children}</div>

      <div className="shrink-0 flex items-center justify-end gap-3 px-4 py-3 border-t border-[color:var(--rule)] bg-[color:var(--surface)]">
        {/* The toolbar carries the announcement for this, so here it is shown and not spoken. */}
        {hasPendingChanges && (
          <p aria-hidden="true" className="rc-why rc-caution mr-auto">
            The list below still reflects your previous settings.
          </p>
        )}
        <button
          type="button"
          onClick={handleApply}
          className={`rc-btn ${hasPendingChanges ? 'rc-btn--go' : ''}`}
        >
          {hasPendingChanges ? 'Update results' : 'Apply filters'}
        </button>
      </div>
    </div>
  );
}
