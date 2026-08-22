/**
 * Placeholder for BoardHeader.
 *
 * Each block stands in for one of the header's slots at the height that slot takes once the
 * board arrives, so the rows below are laid out where they stay. Every surface that renders
 * BoardHeader after a fetch uses this rather than bars of its own: a second set of bars is
 * free to end up a different height from the header it stands in for, and the difference is
 * paid by everything underneath.
 */
export function BoardHeaderSkeleton() {
  return (
    <header className="mb-6" aria-hidden="true">
      {/* Title. */}
      <div className="h-9 w-2/3 rounded-lg image-placeholder" />

      {/* Blurb. It runs from one line to three depending on the board and the width of the
          pane, so the reserve is the middle of that range rather than any one board's. */}
      <div className="mt-2 flex h-12 max-w-2xl flex-col justify-between">
        <div className="h-5 rounded-lg image-placeholder" />
        <div className="h-5 w-4/5 rounded-lg image-placeholder" />
      </div>

      {/* Meta row: the count and the dump date. Laid out like the real one, down to the wrap,
          so a pane too narrow to hold both on one line reserves the second line here too. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="h-5 w-24 rounded-lg image-placeholder" />
        <div className="h-5 w-64 rounded-lg image-placeholder" />
      </div>

      {/* Disclosure button: a label inside the tap target the real button reserves. */}
      <div className="mt-4 flex h-11 items-center">
        <div className="h-4 w-40 rounded image-placeholder" />
      </div>
    </header>
  );
}
