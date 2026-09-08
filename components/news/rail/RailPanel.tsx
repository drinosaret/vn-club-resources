'use client';

import { useEffect, useId, useState } from 'react';
import Link from '@/components/Link';
import { useWide } from '@/lib/use-wide';

/**
 * A panel in the rail, inside a fold.
 *
 * On a wide screen the fold is open and invisible, and the plate is the heading. On a
 * narrow one the fold starts closed with the plate as its summary, so a phone reader
 * gets the stream first and opens what they want. The markup is served open, so a
 * narrow screen sees the panels open for a moment before the script folds them. A
 * toggle made at the narrow width stands while the width holds; crossing to the column
 * layout reopens the fold, since the summary is hidden there and a closed panel would
 * have no control to reopen it.
 *
 * `hideNarrow` leaves the panel out on a narrow screen, for one a strip stands in for.
 */
export function RailPanel({
  id: anchor,
  plate,
  href,
  hrefLabel,
  hideNarrow = false,
  children,
}: {
  /** An anchor for the panel, where a link elsewhere on the site names one. */
  id?: string;
  plate: string;
  href?: string;
  hrefLabel?: string;
  hideNarrow?: boolean;
  children: React.ReactNode;
}) {
  const wide = useWide();
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (wide) setOpen(true);
    else if (!touched) setOpen(false);
  }, [wide, touched]);

  const id = useId();
  const classes = ['nw-fold', hideNarrow ? 'nw-desktop-only' : ''].filter(Boolean).join(' ');
  return (
    <details
      id={anchor}
      className={classes}
      open={open}
      onToggle={(e) => {
        setTouched(true);
        setOpen(e.currentTarget.open);
      }}
    >
      <summary>{plate}</summary>
      <section className="panel dg-panel nw-panel" aria-labelledby={id}>
        <h2 id={id} className="nameplate dg-plate">
          {plate}
        </h2>
        <div className="dg-body">{children}</div>
        {href && hrefLabel && (
          <Link href={href} className="dg-more">
            {hrefLabel}
            <span aria-hidden> →</span>
          </Link>
        )}
      </section>
    </details>
  );
}
