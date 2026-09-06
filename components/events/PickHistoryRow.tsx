import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { getCoverSrc } from '@/lib/vndb-image-cache';
import { eventMeta } from './event-meta';
import type { EventItem } from '@/lib/events';
import { pickPeriodLabel, stripTypeLabel, vnIdFromUrl } from '@/lib/club-history';

/**
 * One past pick, rendered on the server so the whole archive is in the delivered
 * HTML and every title page it names is a crawlable link. The title shown is the
 * romanised one where there is one, with the Japanese title beneath it, rather
 * than the reader's stored preference: the preference lives in the browser and
 * this page has to be readable without it.
 */
export function PickHistoryRow({ item }: { item: EventItem }) {
  const meta = eventMeta(item.event_type);
  const primary = stripTypeLabel(item.title_romaji || item.title, item.event_type);
  const japanese = item.title_jp ? stripTypeLabel(item.title_jp, item.event_type) : null;
  const japaneseTitle = japanese && japanese !== primary ? japanese : null;
  const rawCover = item.cover_url || item.image_url;
  const cover = rawCover ? getCoverSrc(rawCover, { width: 128 }) || rawCover : null;
  const vnId = vnIdFromUrl(item.url);
  const period = pickPeriodLabel(item.event_type, item.start_at);
  const isInternal = !!item.url?.startsWith('/');

  const body = (
    <div className="rel-row">
      <span className="rel-art">
        {cover && (
          <NSFWImage
            src={cover}
            alt={primary}
            imageSexual={item.image_sexual ?? 0}
            vnId={vnId ?? undefined}
            className="h-full w-full object-cover object-top"
            compact
          />
        )}
        {!cover && (
          // A club session has no cover of its own until a title is picked, and an empty
          // frame reads as a failed image rather than as a session without one.
          <meta.Icon className="rel-art-icon" aria-hidden />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={meta.chip}>{meta.label}</span>
          <span className="rel-when">{period}</span>
        </span>
        <span className="rel-title mt-1">{primary}</span>
        {japaneseTitle && (
          <span lang="ja" className="rel-alt font-jp">
            {japaneseTitle}
          </span>
        )}
      </span>
    </div>
  );

  if (isInternal && item.url) {
    return (
      <li>
        <Link href={item.url}>{body}</Link>
      </li>
    );
  }
  // A film night points at the film's own database entry, which is off-site. The target comes
  // from the events table rather than from this app, so only the two schemes a link should
  // carry are followed.
  const externalUrl = item.url && /^https?:\/\//.test(item.url) ? item.url : null;
  if (externalUrl) {
    return (
      <li>
        <a href={externalUrl} target="_blank" rel="noopener noreferrer">
          {body}
        </a>
      </li>
    );
  }
  return <li>{body}</li>;
}
