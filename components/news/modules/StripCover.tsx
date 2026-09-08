'use client';

import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';

/** One tile in a strip: a cover, a title, a sub-line and an optional corner badge. */
export function StripCover({
  href,
  external = false,
  art,
  alt,
  vnId,
  imageSexual = 0,
  title,
  sub,
  badge,
  wide = false,
  lang,
}: {
  href: string | null;
  external?: boolean;
  art: string | null;
  alt: string;
  vnId?: string;
  imageSexual?: number;
  title: React.ReactNode;
  sub?: string | null;
  badge?: string | null;
  /** A video still rather than a cover. */
  wide?: boolean;
  lang?: string;
}) {
  const body = (
    <>
      <span className={wide ? 'nw-strip-art' : 'nw-strip-art nw-strip-art--cover'}>
        {art && (
          <NSFWImage
            src={art}
            alt={alt}
            vnId={vnId}
            imageSexual={imageSexual}
            className="h-full w-full object-cover object-top"
            compact
          />
        )}
        {badge && <span className="nw-strip-badge">{badge}</span>}
      </span>
      <span className="nw-strip-title" lang={lang}>
        {title}
      </span>
      {sub && <span className="nw-strip-sub">{sub}</span>}
    </>
  );
  return (
    <li className="nw-strip-item">
      {href ? (
        external ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {body}
          </a>
        ) : (
          <Link href={href}>{body}</Link>
        )
      ) : (
        <span>{body}</span>
      )}
    </li>
  );
}
