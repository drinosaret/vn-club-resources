'use client';

import type { ReactNode } from 'react';
import Link from '@/components/Link';

import { NSFWImage } from '@/components/NSFWImage';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';

/**
 * The panel shape the stats landing page shows two of, side by side.
 *
 * Shared rather than written twice because the two sit adjacent and are read together: any
 * difference in cover size, row padding or whether rows are divided reads as one of them
 * being broken rather than as variety. Both cards stretch to the taller of the two, so the
 * pair stays level however many rows each has.
 *
 * The rows carry the same four slots in both: an optional standing, a cover, a title with one
 * line of detail under it, and one figure on the right. A panel that cannot fill the detail
 * line should say something true rather than pad it, since an empty line on one side and a
 * full one on the other is the imbalance this exists to avoid.
 */

interface PreviewPanelProps {
  title: string;
  /** Where "see everything" goes, and what to call it. */
  href: string;
  linkLabel: string;
  blurb: string;
  children: ReactNode;
  /** Sits at the bottom of the card, below any trailing space. */
  footer?: ReactNode;
}

export function PreviewPanel({
  title,
  href,
  linkLabel,
  blurb,
  children,
  footer,
}: PreviewPanelProps) {
  return (
    <div className="st-card flex h-full flex-col p-5">
      {/* The link sits under the title in both panels rather than beside it: beside it, a
          long title wraps the link onto a second line while a short one keeps it inline, and
          the two lists then start at different heights. */}
      <div className="mb-1 flex flex-col items-start gap-0.5">
        <h2 className="st-card-title">{title}</h2>
        <Link href={href} className="sec-more min-h-9 py-1">
          {linkLabel}
          <span aria-hidden>&rarr;</span>
        </Link>
      </div>

      <p className="st-card-sub mb-3">{blurb}</p>

      <ol className="flex-1">{children}</ol>

      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}

interface PreviewRowProps {
  href: string;
  /** Cover image url, before proxying. */
  imageUrl?: string | null;
  imageSexual?: number | null;
  /** Used as the reveal key, so revealing here carries to the title's own page. */
  vnId: string;
  name: string;
  /** One line under the title. */
  detail: string;
  /** Right-hand column. Two stacked lines are fine; more will unbalance the row. */
  figure: ReactNode;
  /** Standing in the list, where the list is a ranking. */
  place?: number;
}

export function PreviewRow({
  href,
  imageUrl,
  imageSexual,
  vnId,
  name,
  detail,
  figure,
  place,
}: PreviewRowProps) {
  return (
    <li>
      <Link href={href} className="dg-row st-mid group">
        {place !== undefined ? <span className="dg-rank">{place}</span> : null}

        <span className="relative h-11 w-8 shrink-0 self-center overflow-hidden rounded-xs border border-[color:var(--rule)] bg-[color:var(--surface-inset)]">
          {imageUrl ? (
            <NSFWImage
              src={getProxiedImageUrl(imageUrl, 128)}
              alt={name}
              vnId={vnId}
              imageSexual={imageSexual ?? 0}
              className="h-full w-full object-cover"
              compact
            />
          ) : null}
        </span>

        <span className="min-w-0 flex-1 self-center">
          <span className="dg-name block">{name}</span>
          <span className="block truncate font-mono text-xs tabular-nums text-[color:var(--text-faint)]">
            {detail}
          </span>
        </span>

        <span className="shrink-0 self-center text-right">{figure}</span>
      </Link>
    </li>
  );
}
