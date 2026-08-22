'use client';

import type { ReactNode } from 'react';
import Link from '@/components/Link';
import { ArrowRight } from 'lucide-react';

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
  icon: ReactNode;
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
  icon,
  title,
  href,
  linkLabel,
  blurb,
  children,
  footer,
}: PreviewPanelProps) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200/60 bg-white p-5 shadow-md shadow-gray-200/50 dark:border-gray-700/80 dark:bg-gray-800 dark:shadow-none">
      <div className="mb-1 flex items-start justify-between gap-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
          {icon}
          {title}
        </h2>
        <Link
          href={href}
          className="-my-1 inline-flex min-h-9 shrink-0 items-center gap-1 rounded px-1 text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
        >
          {linkLabel}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{blurb}</p>

      <ol className="flex-1 space-y-1">{children}</ol>

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
      <Link
        href={href}
        className="group -m-0.5 flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
      >
        {place !== undefined ? (
          <span className="w-4 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-400 dark:text-gray-500">
            {place}
          </span>
        ) : null}

        <span className="relative h-11 w-8 shrink-0 overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
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

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900 transition-colors group-hover:text-primary-600 dark:text-white dark:group-hover:text-primary-400">
            {name}
          </span>
          <span className="block truncate text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {detail}
          </span>
        </span>

        <span className="shrink-0 text-right">{figure}</span>
      </Link>
    </li>
  );
}
