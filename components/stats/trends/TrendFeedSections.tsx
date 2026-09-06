'use client';

import Link from '@/components/Link';

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
  title: string;
  blurb: string;
  entries: T[];
  detail: (entry: T) => string;
  figure: (entry: T) => string;
  /**
   * Whether the figures behind this section exist yet.
   *
   * A section with nothing in it and a section whose figures have not been worked out yet
   * look identical, and telling a reader to wait for a rebuild that has already run leaves
   * them waiting for something that is never going to change.
   */
  built?: boolean;
}

function FeedList<T extends TitleIdentity>({
  title,
  blurb,
  entries,
  detail,
  figure,
  built = true,
}: FeedListProps<T>) {
  const { preference } = useTitlePreference();

  return (
    <div className="st-card p-4 sm:p-5">
      <h3 className="st-card-title">{title}</h3>
      <p className="st-card-sub mb-3 mt-0.5">{blurb}</p>
      {/* An empty section says so rather than rendering nothing: a heading and a blurb
          standing over a gap reads as a page that only half arrived. */}
      {!entries.length ? (
        <p className="st-card-sub py-4 text-center">
          {built
            ? 'Nothing here at the moment.'
            : 'Not available until the nightly rebuild has run.'}
        </p>
      ) : null}

      <ol className="space-y-0.5">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Link
              href={entry.href}
              className="dg-row st-mid group"
            >
              <span className="relative h-11 w-8 shrink-0 overflow-hidden rounded-xs border border-[color:var(--rule)] bg-[color:var(--surface-inset)]">
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
                <span className="dg-name block">
                  {name(entry, preference)}
                </span>
                <span className="block truncate font-mono text-xs tabular-nums text-[color:var(--text-faint)]">
                  {detail(entry)}
                </span>
              </span>
              <span className="st-num shrink-0 text-sm text-[color:var(--ink)]">
                {figure(entry)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function NewReleasesList({ entries, built }: { entries: NewReleaseTitle[]; built?: boolean }) {
  return (
    <FeedList
      title="New and finding an audience"
      blurb="Out in the last six months, by the votes they have drawn in the last thirty days. Titles leave this list by ageing out of it."
      entries={entries}
      built={built}
      detail={(entry) => `out ${formatDate(entry.released)}, rating ${entry.score.toFixed(2)}`}
      figure={(entry) => entry.votes.toLocaleString()}
    />
  );
}

export function FinishingList({ entries, built }: { entries: FinishedTitle[]; built?: boolean }) {
  return (
    <FeedList
      title="Being finished right now"
      blurb="Reading lists marked finished in the last sixty days. Dated on the entry rather than on a vote, so this counts an event rather than an opinion, and only readers who fill the field in."
      entries={entries}
      built={built}
      detail={() => 'finished recently'}
      figure={(entry) => entry.finishes.toLocaleString()}
    />
  );
}

export function AnticipatedList({ entries, built }: { entries: AnticipatedTitle[]; built?: boolean }) {
  return (
    <FeedList
      title="Still to come"
      blurb="Japanese titles with nothing released yet and a date ahead, by how many readers are waiting. A port or a remaster does not qualify a title, so the figure is anticipation rather than reception."
      entries={entries}
      built={built}
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
          <p className="st-card-sub">
            {change >= 0 ? 'Up' : 'Down'} {Math.abs(change)}% across the period shown. The
            current week is left out until it is complete.
          </p>
        }
      >
        <LineChart
          points={weeks.map((week) => ({ x: week.week, y: week.votes }))}
          color="var(--kohaku)"
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
          <p className="st-card-sub">
            {last.new_readers.toLocaleString()} of {last.readers.toLocaleString()} readers in
            the latest week were casting their first vote.
          </p>
        }
      >
        <LineChart
          points={weeks.map((week) => ({ x: week.week, y: week.readers }))}
          color="var(--ai)"
          area
          formatX={shortWeek}
          formatValue={(value) => value.toLocaleString()}
        />
      </ChartFrame>
    </div>
  );
}
