'use client';

import Link from 'next/link';
import { CalendarClock, CheckCircle2, Sparkles } from 'lucide-react';

import { ChartFrame } from '@/components/charts/ChartFrame';
import { LineChart } from '@/components/charts/LineChart';
import { NSFWImage } from '@/components/NSFWImage';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { getDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import type { TitlePreference } from '@/lib/title-preference';
import type {
  AnticipatedTitle,
  FinishedTitle,
  NewReleaseTitle,
  PulseWeek,
  TitleIdentity,
} from '@/lib/vndb-stats-api';

/**
 * The feed's shorter sections, and the community's own activity.
 *
 * Each of these turns over on its own: a title ages out of the new-release list, a release
 * date passes, a week rolls off the pulse. None of them can be answered once and left.
 */

function name(entry: TitleIdentity, preference: TitlePreference): string {
  return getDisplayTitle(
    {
      title: entry.title,
      title_jp: entry.title_jp ?? undefined,
      title_romaji: entry.title_romaji ?? undefined,
    },
    preference,
  );
}

/** "2025-08-18" as "18 Aug", short enough that a run of weekly labels does not collide. */
function shortWeek(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** "2026-03-27" as "27 Mar 2026", which is unambiguous in any locale. */
function formatDate(value: string | null): string {
  if (!value) return 'date unannounced';
  const [year, month, day] = value.split('-').map(Number);
  const label = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return label;
}

interface FeedListProps<T extends TitleIdentity> {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  entries: T[];
  detail: (entry: T) => string;
  figure: (entry: T) => string;
}

function FeedList<T extends TitleIdentity>({
  icon,
  title,
  blurb,
  entries,
  detail,
  figure,
}: FeedListProps<T>) {
  const { preference } = useTitlePreference();

  return (
    <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/80 bg-white dark:bg-gray-800 p-4 sm:p-5">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
        {icon}
        {title}
      </h3>
      <p className="mt-0.5 mb-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        {blurb}
      </p>
      {/* A section with nothing in it says so. Returning null here left the heading and its
          blurb standing over a gap, which reads as a page that half loaded. */}
      {!entries.length ? (
        <p className="py-4 text-center text-xs text-gray-500 dark:text-gray-400">
          Not available until the nightly rebuild has run.
        </p>
      ) : null}

      <ol className="space-y-0.5">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Link
              href={entry.href}
              className="group flex items-center gap-3 rounded-lg p-1.5 -m-0.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
            >
              <span className="relative w-8 h-11 shrink-0 overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
                {entry.image_url ? (
                  <NSFWImage
                    src={getProxiedImageUrl(entry.image_url, 128)}
                    alt=""
                    vnId={entry.id}
                    imageSexual={entry.image_sexual ?? 0}
                    className="w-full h-full object-cover"
                    compact
                  />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                  {name(entry, preference)}
                </span>
                <span className="block text-xs tabular-nums text-gray-500 dark:text-gray-400">
                  {detail(entry)}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                {figure(entry)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function NewReleasesList({ entries }: { entries: NewReleaseTitle[] }) {
  return (
    <FeedList
      icon={<Sparkles className="w-4 h-4 text-violet-500" />}
      title="New and finding an audience"
      blurb="Out in the last six months, by the votes they have drawn in the last thirty days. Titles leave this list by ageing out of it."
      entries={entries}
      detail={(entry) => `out ${formatDate(entry.released)}, rating ${entry.score.toFixed(2)}`}
      figure={(entry) => entry.votes.toLocaleString()}
    />
  );
}

export function FinishingList({ entries }: { entries: FinishedTitle[] }) {
  return (
    <FeedList
      icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
      title="Being finished right now"
      blurb="Reading lists marked finished in the last sixty days. Dated on the entry rather than on a vote, so this counts an event rather than an opinion, and only readers who fill the field in."
      entries={entries}
      detail={() => 'finished recently'}
      figure={(entry) => entry.finishes.toLocaleString()}
    />
  );
}

export function AnticipatedList({ entries }: { entries: AnticipatedTitle[] }) {
  return (
    <FeedList
      icon={<CalendarClock className="w-4 h-4 text-sky-500" />}
      title="Still to come"
      blurb="Japanese titles with a Japanese release still ahead, by how many readers are waiting. This is work that does not exist yet, so the figure is anticipation rather than reception."
      entries={entries}
      detail={(entry) => `out ${formatDate(entry.out_on)}`}
      figure={(entry) => `${entry.waiting.toLocaleString()} waiting`}
    />
  );
}

export function CommunityPulse({ weeks }: { weeks: PulseWeek[] }) {
  if (weeks.length < 4) return null;

  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const change = first.votes
    ? Math.round(((last.votes - first.votes) / first.votes) * 100)
    : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <ChartFrame
        title="Votes cast each week"
        subtitle={`The last ${weeks.length} weeks`}
        height={190}
        data={{
          caption: 'Votes cast per week',
          columns: ['Week', 'Votes'],
          rows: weeks.map((week) => [shortWeek(week.week), week.votes.toLocaleString()]),
        }}
        footer={
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {change >= 0 ? 'Up' : 'Down'} {Math.abs(change)}% across the period shown. The
            current week is left out until it is complete.
          </p>
        }
      >
        <LineChart
          points={weeks.map((week) => ({ x: week.week, y: week.votes }))}
          color="#f97316"
          area
          formatX={shortWeek}
          formatValue={(value) => value.toLocaleString()}
        />
      </ChartFrame>

      <ChartFrame
        title="Readers voting each week"
        subtitle="Everyone who cast at least one vote that week"
        height={190}
        data={{
          caption: 'Readers voting per week',
          columns: ['Week', 'Readers', 'First-time'],
          rows: weeks.map((week) => [
            shortWeek(week.week),
            week.readers.toLocaleString(),
            week.new_readers.toLocaleString(),
          ]),
        }}
        footer={
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {last.new_readers.toLocaleString()} of {last.readers.toLocaleString()} readers in
            the latest week were casting their first vote.
          </p>
        }
      >
        <LineChart
          points={weeks.map((week) => ({ x: week.week, y: week.readers }))}
          color="#0891b2"
          area
          formatX={shortWeek}
          formatValue={(value) => value.toLocaleString()}
        />
      </ChartFrame>
    </div>
  );
}
