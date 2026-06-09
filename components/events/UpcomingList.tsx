'use client';

import Link from 'next/link';
import type { EventItem } from '@/lib/events';
import { eventMeta, formatTime } from './event-meta';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { NSFWImage } from '@/components/NSFWImage';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';

// /vn/123/ -> "v123", for per-VN NSFW reveal persistence.
function vnIdFromUrl(url: string | null): string | undefined {
  const m = url?.match(/^\/vn\/(\d+)\/?$/);
  return m ? `v${m[1]}` : undefined;
}

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
      <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
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
          <div
            className={`flex items-center gap-3 rounded-xl border border-gray-200 border-l-4 ${meta.accent} bg-white p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800/60`}
          >
            {cover ? (
              <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
                <NSFWImage
                  src={getProxiedImageUrl(cover, { width: 128 }) || cover}
                  alt=""
                  imageSexual={e.image_sexual}
                  vnId={vnIdFromUrl(e.url)}
                  className="h-full w-full object-cover"
                  compact
                />
              </div>
            ) : (
              <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-gray-100 dark:bg-gray-800">
                <meta.Icon className="h-5 w-5 text-gray-400 dark:text-gray-500" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.chip}`}>
                  {meta.label}
                </span>
              </div>
              <p className="mt-0.5 truncate font-medium text-gray-900 dark:text-gray-100">
                {getDisplayTitle(
                  { title: e.title, title_jp: e.title_jp ?? undefined, title_romaji: e.title_romaji ?? undefined },
                  preference,
                )}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {whenLabel(e)}
                {e.location ? ` · ${e.location}` : ''}
              </p>
            </div>
          </div>
        );
        return (
          <li key={e.id}>{e.url ? <Link href={e.url}>{row}</Link> : row}</li>
        );
      })}
    </ul>
  );
}
