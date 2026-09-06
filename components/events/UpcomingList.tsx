'use client';

import Link from '@/components/Link';
import type { EventItem } from '@/lib/events';
import { eventMeta, formatTime } from './event-meta';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { NSFWImage } from '@/components/NSFWImage';
import { getCoverSrc } from '@/lib/vndb-image-cache';
import { vnIdFromUrl } from '@/lib/club-history';

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function whenLabel(e: EventItem): string {
  const start = dateLabel(e.start_at);
  if (e.all_day) {
    return e.end_at ? `${start} – ${dateLabel(e.end_at)}` : start;
  }
  return `${start} · ${formatTime(e.start_at)}`;
}

export default function UpcomingList({ events }: { events: EventItem[] }) {
  const { preference } = useTitlePreference();
  if (events.length === 0) {
    return (
      <p className="panel p-6 text-center text-sm text-[color:var(--nezu)]">
        No upcoming events yet. Check back soon.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {events.map((e) => {
        const meta = eventMeta(e.event_type);
        const cover = e.cover_url || e.image_url;
        const row = (
          <div className="rel-row">
            <span className="rel-art">
              {cover && (
                <NSFWImage
                  src={getCoverSrc(cover, { width: 128 }) || cover}
                  alt=""
                  imageSexual={e.image_sexual}
                  vnId={vnIdFromUrl(e.url) ?? undefined}
                  className="h-full w-full object-cover"
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
              <span className={meta.chip}>{meta.label}</span>
              <span className="rel-title mt-1 truncate">
                {getDisplayTitle(
                  { title: e.title, title_jp: e.title_jp ?? undefined, title_romaji: e.title_romaji ?? undefined },
                  preference,
                )}
              </span>
              <span className="rel-meta font-mono">
                {whenLabel(e)}
                {e.location ? ` · ${e.location}` : ''}
              </span>
            </span>
          </div>
        );
        return (
          <li key={e.id}>{e.url ? <Link href={e.url}>{row}</Link> : row}</li>
        );
      })}
    </ul>
  );
}
