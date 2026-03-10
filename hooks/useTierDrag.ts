import { useEffect, useRef } from 'react';

interface TierDragOptions {
  onDrop: (itemId: string, containerId: string, insertIndex: number) => void;
  onDragStart?: (itemId: string) => void;
  onDragCancel?: () => void;
  mouseDistance?: number;
  touchDelay?: number;
  touchTolerance?: number;
}

/** Compute insert position from DOM element rects at drop time. */
function computeInsertIndex(containerEl: HTMLElement, cx: number, cy: number, draggedId: string): number {
  const items = containerEl.querySelectorAll<HTMLElement>('[data-item-id]');
  if (items.length === 0) return 0;

  let bestIndex = items.length;
  let bestDist = Infinity;

  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    if (el.dataset.itemId === draggedId) continue;
    const rect = el.getBoundingClientRect();
    const elCx = rect.left + rect.width / 2;

    // Drag center is above this item's row - insert before it
    if (cy < rect.top) {
      bestIndex = i;
      break;
    }
    // Same row: check horizontal position
    if (cy < rect.bottom) {
      if (cx < elCx) {
        bestIndex = i;
        break;
      }
      const dist = Math.abs(cx - elCx) + Math.abs(cy - (rect.top + rect.height / 2));
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i + 1;
      }
    }
  }

  return bestIndex;
}

/**
 * Custom zero-re-render drag hook for the tier list.
 *
 * Uses event delegation on a container ref. All visual feedback (overlay,
 * highlights, source dimming) is done via direct DOM manipulation.
 * React state is only updated once at drop time via the onDrop callback.
 */
export function useTierDrag(
  containerRef: React.RefObject<HTMLElement | null>,
  options: TierDragOptions
): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // --- Mutable drag state (closure, NOT React state) ---
    let phase: 'idle' | 'pending' | 'active' = 'idle';
    let ptrId = -1;
    let ptrType = '';
    let startX = 0;
    let startY = 0;
    let grabOffsetX = 0;
    let grabOffsetY = 0;
    let draggedId = '';
    let sourceEl: HTMLElement | null = null;
    let overlay: HTMLElement | null = null;
    let currentOverContainer: string | null = null;
    let touchTimer: ReturnType<typeof setTimeout> | null = null;
    let lastClientX = 0;
    let lastClientY = 0;
    let autoScrollRaf = 0;

    // Cached drop zone elements + rects — refreshed on activate and scroll.
    // Caching elements avoids querySelector calls in the pointermove hot path.
    let dropZoneCache: { id: string; el: HTMLElement; rect: DOMRect }[] = [];
    let scrollOffset = 0; // window.scrollY at cache time

    function refreshDropZoneCache() {
      scrollOffset = window.scrollY;
      const zones = document.querySelectorAll<HTMLElement>('[data-tier-drop]');
      dropZoneCache = [];
      for (let i = zones.length - 1; i >= 0; i--) {
        dropZoneCache.push({ id: zones[i].dataset.tierDrop!, el: zones[i], rect: zones[i].getBoundingClientRect() });
      }
    }

    function hitTestDropZone(cx: number, cy: number): string | null {
      // Adjust rects if page has scrolled since last cache
      const scrollDelta = window.scrollY - scrollOffset;
      for (const { id, rect } of dropZoneCache) {
        const top = rect.top - scrollDelta;
        const bottom = rect.bottom - scrollDelta;
        if (cx >= rect.left && cx <= rect.right && cy >= top && cy <= bottom) {
          return id;
        }
      }
      return null;
    }

    /** Look up a cached drop zone element by id (O(n) over small array). */
    function getDropZoneEl(id: string): HTMLElement | undefined {
      for (const zone of dropZoneCache) {
        if (zone.id === id) return zone.el;
      }
      return undefined;
    }

    // --- Helpers ---

    function findItemElement(target: EventTarget | null): HTMLElement | null {
      let el = target as HTMLElement | null;
      while (el && el !== container) {
        if (el.dataset.itemId) return el;
        el = el.parentElement;
      }
      return null;
    }

    function isActionButton(target: EventTarget | null, itemEl: HTMLElement): boolean {
      let el = target as HTMLElement | null;
      while (el && el !== itemEl) {
        if (el.classList.contains('touch-action-btn')) return true;
        el = el.parentElement;
      }
      return false;
    }

    // --- Activation ---

    function activate() {
      if (!sourceEl) return;
      phase = 'active';

      const rect = sourceEl.getBoundingClientRect();
      grabOffsetX = startX - rect.left;
      grabOffsetY = startY - rect.top;

      // Clone BEFORE dimming so the clone doesn't inherit tier-dragging-source
      overlay = sourceEl.cloneNode(true) as HTMLElement;

      // Now dim the source
      sourceEl.classList.add('tier-dragging-source');

      const x = lastClientX - grabOffsetX;
      const y = lastClientY - grabOffsetY;
      overlay.style.cssText = `
        position: fixed;
        z-index: 9999;
        pointer-events: none;
        will-change: transform;
        width: ${rect.width}px;
        height: ${rect.height}px;
        margin: 0;
        top: 0;
        left: 0;
        transform: translate3d(${x}px, ${y}px, 0) scale(1.04);
        opacity: 0;
        box-shadow: 0 8px 24px rgba(0,0,0,0.18);
        border-radius: 4px;
      `;
      overlay.classList.add('tier-drag-overlay');
      // Clean up clone: remove buttons, tooltips, placeholders, force images visible
      overlay.removeAttribute('title');
      overlay.querySelectorAll('button').forEach(b => b.remove());
      overlay.querySelectorAll('.image-placeholder').forEach(p => p.remove());
      overlay.querySelectorAll('img').forEach(img => {
        img.style.opacity = '1';
        img.classList.remove('opacity-0');
        img.removeAttribute('decoding');
        img.removeAttribute('loading');
      });
      document.body.appendChild(overlay);
      // Show overlay after one frame so images have time to decode
      requestAnimationFrame(() => {
        if (overlay) overlay.style.opacity = '1';
      });

      // Prevent touch scrolling and text selection during drag
      document.documentElement.style.touchAction = 'none';
      document.documentElement.style.userSelect = 'none';
      document.documentElement.style.cursor = 'grabbing';

      // Suppress hover effects and pointer-events on tier items during drag.
      // This prevents the browser from doing hit-test/style recalc on every
      // item the overlay passes over, which is the main source of drag jank.
      container?.classList.add('tier-dragging');

      // Hide pool scroll during drag
      const poolScroll = document.querySelector('.tier-pool-scroll') as HTMLElement | null;
      if (poolScroll) poolScroll.style.overflowY = 'hidden';

      // Cache drop zone rects for fast hit-testing
      refreshDropZoneCache();

      // Start auto-scroll loop
      startAutoScroll();

      optionsRef.current.onDragStart?.(draggedId);
    }

    // --- Auto-scroll near viewport edges ---

    function startAutoScroll() {
      const EDGE = 40; // px from viewport edge
      const MAX_SPEED = 12; // px per frame

      function tick() {
        if (phase !== 'active') return;

        const viewH = window.innerHeight;
        let scrollDelta = 0;

        if (lastClientY < EDGE) {
          scrollDelta = -MAX_SPEED * (1 - lastClientY / EDGE);
        } else if (lastClientY > viewH - EDGE) {
          scrollDelta = MAX_SPEED * (1 - (viewH - lastClientY) / EDGE);
        }

        if (scrollDelta !== 0) {
          window.scrollBy(0, scrollDelta);
          // Only refresh the scroll offset — element positions relative to
          // the document haven't changed, just the viewport shifted.
          scrollOffset = window.scrollY;
        }

        autoScrollRaf = requestAnimationFrame(tick);
      }

      autoScrollRaf = requestAnimationFrame(tick);
    }

    // --- Event handlers ---

    function onPointerDown(e: PointerEvent) {
      if (phase !== 'idle') return;
      if (e.button !== 0) return;

      const itemEl = findItemElement(e.target);
      if (!itemEl) return;
      if (isActionButton(e.target, itemEl)) return;

      ptrId = e.pointerId;
      ptrType = e.pointerType;
      startX = e.clientX;
      startY = e.clientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      draggedId = itemEl.dataset.itemId!;
      sourceEl = itemEl;
      phase = 'pending';

      if (ptrType === 'touch') {
        touchTimer = setTimeout(() => {
          if (phase === 'pending') activate();
        }, optionsRef.current.touchDelay ?? 150);
      }

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onCancel);
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('dragstart', onDragStart);
      document.addEventListener('selectstart', onSelectStart);
      document.addEventListener('contextmenu', onContextMenu);
    }

    function onPointerMove(e: PointerEvent) {
      if (e.pointerId !== ptrId) return;

      lastClientX = e.clientX;
      lastClientY = e.clientY;

      if (phase === 'pending') {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (ptrType === 'touch') {
          // Too much movement before delay elapsed - cancel (user is scrolling).
          // Native scroll takes over since onTouchMove stops calling preventDefault.
          if (dist > (optionsRef.current.touchTolerance ?? 5)) {
            cancel();
            return;
          }
        } else {
          // Mouse: activate after distance threshold
          if (dist >= (optionsRef.current.mouseDistance ?? 5)) {
            activate();
          }
        }
        return;
      }

      if (phase !== 'active' || !overlay) return;
      e.preventDefault(); // prevent scroll on touch

      // Update overlay position (GPU-composited, no layout)
      const x = e.clientX - grabOffsetX;
      const y = e.clientY - grabOffsetY;
      overlay.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.04)`;

      // Hit-test drop containers using cached rects
      const hitContainer = hitTestDropZone(e.clientX, e.clientY);

      if (hitContainer !== currentOverContainer) {
        // Use cached elements instead of querySelector in the hot path
        if (currentOverContainer) {
          getDropZoneEl(currentOverContainer)?.classList.remove('tier-drop-highlight');
        }
        if (hitContainer) {
          getDropZoneEl(hitContainer)?.classList.add('tier-drop-highlight');
        }
        currentOverContainer = hitContainer;
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (e.pointerId !== ptrId) return;

      if (phase === 'active' && currentOverContainer) {
        // Use cached element for insert index computation
        const containerEl = getDropZoneEl(currentOverContainer);
        const insertIndex = containerEl
          ? computeInsertIndex(containerEl, e.clientX, e.clientY, draggedId)
          : 0;
        const id = draggedId;
        const target = currentOverContainer;
        cleanup();
        optionsRef.current.onDrop(id, target, Math.max(0, insertIndex));
      } else {
        cancel();
      }
    }

    function onDragStart(e: DragEvent) {
      // Prevent native drag (images, text selection) from stealing pointer events
      e.preventDefault();
    }

    function onSelectStart(e: Event) {
      if (phase !== 'idle') e.preventDefault();
    }

    /**
     * Permanent non-passive touchmove listener on the container.
     *
     * Because this is always registered (not added dynamically on pointerdown),
     * the browser compositor knows it must wait for JS before starting a scroll
     * gesture. This lets us block scroll during the pending hold window and
     * during active drag, while allowing full native scroll otherwise.
     */
    function onTouchMove(e: TouchEvent) {
      if (phase === 'active') {
        e.preventDefault();
        return;
      }
      if (phase === 'pending') {
        // Block scroll while the finger is still near the start point (holding
        // to initiate drag). Once the finger moves beyond tolerance, the
        // pointermove handler calls cancel() and phase becomes idle, so
        // subsequent touchmove events fall through without preventDefault -
        // the browser then handles native scroll with full momentum.
        const touch = e.touches[0];
        if (touch) {
          const dx = touch.clientX - startX;
          const dy = touch.clientY - startY;
          if (dx * dx + dy * dy <= (optionsRef.current.touchTolerance ?? 5) ** 2) {
            e.preventDefault();
          }
        }
      }
    }

    function onContextMenu(e: Event) {
      // Block the native long-press context menu ("Save image", etc.)
      // during pending and active phases
      if (phase !== 'idle') e.preventDefault();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') cancel();
    }

    function onCancel() {
      cancel();
    }

    function cancel() {
      cleanup();
      optionsRef.current.onDragCancel?.();
    }

    function cleanup() {
      if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
      cancelAnimationFrame(autoScrollRaf);

      if (overlay) {
        overlay.remove();
        overlay = null;
      }
      if (sourceEl) {
        sourceEl.classList.remove('tier-dragging-source');
      }
      if (currentOverContainer) {
        getDropZoneEl(currentOverContainer)?.classList.remove('tier-drop-highlight');
      }

      // Remove drag isolation class
      container?.classList.remove('tier-dragging');

      document.documentElement.style.touchAction = '';
      document.documentElement.style.userSelect = '';
      document.documentElement.style.cursor = '';
      const poolScroll = document.querySelector('.tier-pool-scroll') as HTMLElement | null;
      if (poolScroll) poolScroll.style.overflowY = '';

      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('dragstart', onDragStart);
      document.removeEventListener('selectstart', onSelectStart);
      document.removeEventListener('contextmenu', onContextMenu);

      phase = 'idle';
      sourceEl = null;
      draggedId = '';
      currentOverContainer = null;
      dropZoneCache = [];
    }

    // Prevent native drag on images/text within the container (capture phase = earliest possible)
    container.addEventListener('dragstart', onDragStart, true);
    container.addEventListener('pointerdown', onPointerDown);
    // Permanent non-passive touchmove: forces the compositor to consult JS
    // before starting a scroll gesture, so we can block scroll during the
    // pending hold window. Must be on the container (not added dynamically
    // on pointerdown) so the compositor knows about it at touchstart time.
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      container.removeEventListener('dragstart', onDragStart, true);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('touchmove', onTouchMove);
      cleanup();
    };
  }, [containerRef]);
}
