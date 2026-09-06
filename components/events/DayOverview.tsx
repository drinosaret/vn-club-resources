'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/Link';
import { X } from 'lucide-react';
import type { EventItem } from '@/lib/events';
import { eventMeta, formatTime } from './event-meta';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { getCoverSrc } from '@/lib/vndb-image-cache';

interface VotdData {
  vn_id: string;
  title: string;
  title_jp: string | null;
  title_romaji: string | null;
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
  // The cover comes from the local cache at the size this frame needs rather than from the
  // source CDN, and the VN id in the path is what lets a blacklisted cover be substituted.
  const votdCover = votdImgOk
    ? getCoverSrc(votd?.image_url, { width: 128, vnId: votd?.vn_id })
    : null;

  const votdNames = votd
    ? {
        title: votd.title,
        title_jp: votd.title_jp ?? undefined,
        title_romaji: votd.title_romaji ?? undefined,
      }
    : null;
  const votdPrimary = votdNames ? getDisplayTitle(votdNames, preference) : '';
  // The other script is only a second line where it is a different string; the original
  // title of a Japanese release is usually the Japanese one, so the two often coincide.
  const votdOther = votdNames
    ? getDisplayTitle(votdNames, preference === 'japanese' ? 'romaji' : 'japanese')
    : '';
  const votdSecondary = votdOther && votdOther !== votdPrimary ? votdOther : null;

  return (
    <div className="ev-scrim" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xs border border-[color:var(--rule)] bg-[color:var(--surface)] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-display font-bold text-[color:var(--ink)]">{heading}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="toy-btn toy-btn--icon shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <section className="mb-4">
          <h4 className="fig-label mb-1.5">Events</h4>
          {events.length > 0 ? (
            <ul className="space-y-1">
              {events.map((e) => {
                const meta = eventMeta(e.event_type);
                const row = (
                  <div className="rel-row">
                    <span className={`${meta.chip} shrink-0`}>{meta.label}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-[color:var(--ink)]">
                      {getDisplayTitle(
                        { title: e.title, title_jp: e.title_jp ?? undefined, title_romaji: e.title_romaji ?? undefined },
                        preference,
                      )}
                    </span>
                    {!e.all_day && <span className="rel-when ml-auto">{formatTime(e.start_at)}</span>}
                  </div>
                );
                return <li key={e.id}>{e.url ? <Link href={e.url}>{row}</Link> : row}</li>;
              })}
            </ul>
          ) : (
            <p className="text-sm text-[color:var(--nezu)]">No club events this day.</p>
          )}
        </section>

        <section className="mb-4">
          <h4 className="fig-label mb-1.5">VN of the Day</h4>
          {loading ? (
            <p className="text-sm text-[color:var(--nezu)]">Loading…</p>
          ) : votd ? (
            <Link href={`/vn/${votd.vn_id.replace('v', '')}/`} className="rel-row">
              <span className="rel-art">
                {votdCover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={votdCover}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="rel-title truncate" lang={preference === 'japanese' ? 'ja' : undefined}>
                  {votdPrimary}
                </span>
                {votdSecondary && (
                  <span className="rel-alt truncate" lang={preference === 'japanese' ? undefined : 'ja'}>
                    {votdSecondary}
                  </span>
                )}
                {votd.rating != null && (
                  <span className="rel-meta font-mono tabular-nums">★ {votd.rating.toFixed(2)}</span>
                )}
              </span>
            </Link>
          ) : (
            <p className="text-sm text-[color:var(--nezu)]">No VN of the Day for this date.</p>
          )}
        </section>

        <section>
          <h4 className="fig-label mb-1.5">Word of the Day</h4>
          {loading ? (
            <p className="text-sm text-[color:var(--nezu)]">Loading…</p>
          ) : wotd ? (
            <Link
              href={`/word-of-the-day?date=${iso}`}
              className="block rounded-xs border border-[color:var(--rule)] bg-[color:var(--surface)] p-3 transition-colors hover:border-[color:var(--kohaku)]"
            >
              <span className="block font-jp text-lg text-[color:var(--ink)]">
                {stripFurigana(wotd.main_reading?.text || '')}
              </span>
              {wotd.parts_of_speech?.length > 0 && (
                <span className="rel-meta font-mono">{wotd.parts_of_speech.slice(0, 3).join(' · ')}</span>
              )}
              {wotd.definitions?.[0]?.meanings?.length > 0 && (
                <span className="mt-1 block text-sm text-[color:var(--text-secondary)]">
                  {wotd.definitions[0].meanings.slice(0, 3).join('; ')}
                </span>
              )}
            </Link>
          ) : (
            <p className="text-sm text-[color:var(--nezu)]">No Word of the Day for this date.</p>
          )}
          {wotd && !loading ? (
            <p className="wd-credit mt-1.5">
              Word data from{' '}
              <a href="https://jiten.moe" target="_blank" rel="noopener noreferrer">
                jiten.moe
              </a>
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
