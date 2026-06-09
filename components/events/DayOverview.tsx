'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import type { EventItem } from '@/lib/events';
import { eventMeta, formatTime } from './event-meta';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';

interface VotdData {
  vn_id: string;
  title: string;
  title_jp: string | null;
  image_url: string | null;
  image_sexual: number | null;
  rating: number | null;
}

interface WotdData {
  word_id: number;
  main_reading: { text: string } | null;
  parts_of_speech: string[];
  definitions: { meanings: string[] }[];
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// jiten.moe returns readings in bracket-furigana notation (米[こめ]騒[そう]動[どう]).
function stripFurigana(s: string): string {
  return s.replace(/\[[^\]]*\]/g, '');
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const base = process.env.NEXT_PUBLIC_VNDB_STATS_API;
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default function DayOverview({
  date,
  events,
  onClose,
}: {
  date: Date;
  events: EventItem[];
  onClose: () => void;
}) {
  const iso = isoDate(date);
  const { preference } = useTitlePreference();
  const [votd, setVotd] = useState<VotdData | null>(null);
  const [wotd, setWotd] = useState<WotdData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchJson<VotdData>(`/api/v1/vn-of-the-day?date=${iso}`),
      fetchJson<WotdData>(`/api/v1/word-of-the-day?date=${iso}`),
    ])
      .then(([v, w]) => {
        if (active) {
          setVotd(v);
          setWotd(w);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [iso]);

  const heading = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const votdImgOk = votd?.image_url && (votd.image_sexual == null || votd.image_sexual < 1.5);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">{heading}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <section className="mb-4">
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Events</h4>
          {events.length > 0 ? (
            <ul className="space-y-1">
              {events.map((e) => {
                const meta = eventMeta(e.event_type);
                const row = (
                  <div className="flex items-center gap-2 rounded-md border border-gray-100 px-2 py-1.5 dark:border-gray-800">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.chip}`}>
                      {meta.label}
                    </span>
                    <span className="truncate text-sm text-gray-800 dark:text-gray-200">
                      {getDisplayTitle(
                        { title: e.title, title_jp: e.title_jp ?? undefined, title_romaji: e.title_romaji ?? undefined },
                        preference,
                      )}
                    </span>
                    {!e.all_day && (
                      <span className="ml-auto shrink-0 text-xs text-gray-400">{formatTime(e.start_at)}</span>
                    )}
                  </div>
                );
                return <li key={e.id}>{e.url ? <Link href={e.url}>{row}</Link> : row}</li>;
              })}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">No club events this day.</p>
          )}
        </section>

        <section className="mb-4">
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
            VN of the Day
          </h4>
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : votd ? (
            <Link
              href={`/vn/${votd.vn_id.replace('v', '')}/`}
              className="flex gap-3 rounded-md border border-gray-100 p-2 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60"
            >
              {votdImgOk ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={votd.image_url!}
                  alt=""
                  className="h-20 w-14 shrink-0 rounded object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="h-20 w-14 shrink-0 rounded bg-gray-100 dark:bg-gray-800" />
              )}
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                  {votd.title_jp || votd.title}
                </p>
                {votd.title_jp && <p className="truncate text-xs text-gray-500">{votd.title}</p>}
                {votd.rating != null && (
                  <p className="mt-1 text-xs text-gray-500">★ {votd.rating.toFixed(2)}</p>
                )}
              </div>
            </Link>
          ) : (
            <p className="text-sm text-gray-400">No VN of the Day for this date.</p>
          )}
        </section>

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Word of the Day
          </h4>
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : wotd ? (
            <Link
              href={`/word-of-the-day?date=${iso}`}
              className="block rounded-md border border-gray-100 p-2 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60"
            >
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {stripFurigana(wotd.main_reading?.text || '')}
              </p>
              {wotd.parts_of_speech?.length > 0 && (
                <p className="text-xs text-gray-400">{wotd.parts_of_speech.slice(0, 3).join(' · ')}</p>
              )}
              {wotd.definitions?.[0]?.meanings?.length > 0 && (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {wotd.definitions[0].meanings.slice(0, 3).join('; ')}
                </p>
              )}
            </Link>
          ) : (
            <p className="text-sm text-gray-400">No Word of the Day for this date.</p>
          )}
        </section>
      </div>
    </div>
  );
}
