'use client';

/**
 * The advance marker.
 *
 * A visual novel puts one of these in the corner of its text box to say there is more. Here it
 * says the same thing and then does it: a real button, in the tab order, that moves the reader
 * to the next section. A marker that pulsed and did nothing would be the one element on this
 * page that reads as costume.
 */
export function AdvanceMarker({ targetId }: { targetId: string }) {
  return (
    <button
      type="button"
      className="tb-marker"
      aria-label="Continue to what the club is reading"
      onClick={() => {
        const target = document.getElementById(targetId);
        if (!target) return;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      }}
    >
      <svg width="16" height="10" viewBox="0 0 16 10" fill="none" aria-hidden>
        <path d="M1 1L8 8L15 1" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      </svg>
    </button>
  );
}
