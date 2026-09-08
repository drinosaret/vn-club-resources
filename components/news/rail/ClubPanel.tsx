import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import type { EventItem } from '@/lib/events';
import { stripTypeLabel, vnIdFromUrl } from '@/lib/club-history';
import { eventMeta, formatTime } from '@/components/events/event-meta';
import { getCoverSrc } from '@/lib/vndb-image-cache';
import { VNTitle } from '@/components/VNTitle';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { RailPanel } from './RailPanel';

const MAX_EVENTS = 4;

// The date beside a title in a rail is held to the day and, where there is one, the hour:
// the column is narrow, and the weekday is the part a reader can do without.
function when(e: EventItem, locale: Locale): string {
  const day = new Date(e.start_at).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return e.all_day ? day : `${day} · ${formatTime(e.start_at)}`;
}

// Only the club's reading picks belong on a page about visual novels, and only once a title
// has actually been picked: a session slot with nothing chosen yet says nothing.
const PICK_TYPES = new Set(['vn_of_month', 'vn_of_season', 'roudoku']);

/** The club's current picks, from the calendar, each with the picked title's cover. */
export function ClubPanel({ locale, events }: { locale: Locale; events: EventItem[] }) {
  const rows = events
    .filter((e) => PICK_TYPES.has(e.event_type) && vnIdFromUrl(e.url))
    .slice(0, MAX_EVENTS);
  if (rows.length === 0) return null;
  return (
    <RailPanel plate={ns(locale, 'rail.club')} href="/events/" hrefLabel={ns(locale, 'rail.club.more')}>
      <ul className="nw-release-list">
        {rows.map((e) => {
          const meta = eventMeta(e.event_type);
          const art = getCoverSrc(e.cover_url || e.image_url, { width: 128 });
          const vnId = vnIdFromUrl(e.url) ?? undefined;
          // The chip already names the pick, so the title is shown without that prefix.
          const name = (
            <VNTitle
              title={stripTypeLabel(e.title, e.event_type)}
              title_jp={e.title_jp}
              title_romaji={e.title_romaji}
            />
          );
          const body = (
            <span className="rel-row">
              <span className="rel-art">
                {art && (
                  <NSFWImage
                    src={art}
                    alt={e.title}
                    vnId={vnId}
                    imageSexual={e.image_sexual ?? 0}
                    className="h-full w-full object-cover object-top"
                    compact
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`${meta.chip} mb-1 inline-block`}>{meta.label}</span>
                <span className="rel-title">{name}</span>
              </span>
              <span className="rel-when">{when(e, locale)}</span>
            </span>
          );
          return (
            <li key={e.id} className="nw-release">
              {e.url ? <Link href={e.url}>{body}</Link> : body}
            </li>
          );
        })}
      </ul>
    </RailPanel>
  );
}
