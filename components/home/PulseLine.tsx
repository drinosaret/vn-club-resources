import Link from '@/components/Link';

import type { PulseWeek } from '@/lib/community-pulse';

/**
 * How much reading happened in the last complete week the dump covers, drawn rather than
 * claimed.
 *
 * This sits where a catalogue size would normally go, and it names its source for the same
 * reason the catalogue size was dropped: the figures are VNDB's, and presenting them as this
 * site's own would take credit for another project's data and misdescribe who it counts.
 *
 * The line is deliberately unlabelled. It is there to show a shape, and a reader who wants
 * the numbers behind it has a link to the page that plots them properly.
 */

interface PulseLineProps {
  weeks: PulseWeek[];
  votesThisWeek: number | null;
  votesLastWeek: number | null;
  readersThisWeek: number | null;
}

const SPARK_WIDTH = 132;
const SPARK_HEIGHT = 28;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** A week start as a reader would say it, from the ISO date the feed carries. */
function weekLabel(week: string): string {
  const [, month, day] = week.split('-').map(Number);
  const name = MONTHS[month - 1];
  return name ? `${day} ${name}` : week;
}

/** The path through the weekly totals, normalised to the band it is drawn in. */
function sparkPath(weeks: PulseWeek[]): string | null {
  const points = weeks.slice(-24).map((w) => w.votes);
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  // A flat run would divide by zero and is drawn as a flat line rather than skipped.
  const span = max - min || 1;
  const step = SPARK_WIDTH / (points.length - 1);

  return points
    .map((value, i) => {
      const x = i * step;
      const y = SPARK_HEIGHT - ((value - min) / span) * SPARK_HEIGHT;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function PulseLine({ weeks, votesThisWeek, votesLastWeek, readersThisWeek }: PulseLineProps) {
  if (votesThisWeek === null) return null;

  // The series ends at the last week the dump covers in full, which is several days behind
  // the reader's own week, so the figure is named by its week rather than as the current one.
  const latestWeek = weeks.length > 0 ? weeks[weeks.length - 1].week : null;
  const path = sparkPath(weeks);
  const change =
    votesLastWeek && votesLastWeek > 0
      ? Math.round(((votesThisWeek - votesLastWeek) / votesLastWeek) * 100)
      : null;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      {path && (
        <svg
          viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
          width={SPARK_WIDTH}
          height={SPARK_HEIGHT}
          className="shrink-0 overflow-visible opacity-90"
          aria-hidden
        >
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[color:var(--kohaku)]"
          />
        </svg>
      )}

      <p className="text-sm text-[color:var(--nezu)]">
        <span className="font-mono font-medium tabular-nums text-[color:var(--ink-box)]">
          {votesThisWeek.toLocaleString()}
        </span>{' '}
        {latestWeek
          ? `ratings logged in the week of ${weekLabel(latestWeek)}`
          : 'ratings logged in the latest full week'}
        {readersThisWeek ? (
          <>
            {' by '}
            <span className="font-mono font-medium tabular-nums text-[color:var(--ink-box)]">
              {readersThisWeek.toLocaleString()}
            </span>{' '}
            readers on VNDB
          </>
        ) : null}
        {change !== null && change !== 0 && (
          <span>
            , {change > 0 ? 'up' : 'down'} {Math.abs(change)}% on the week before
          </span>
        )}
        .{' '}
        <Link
          href="/stats/trends/"
          className="underline underline-offset-2 transition-colors hover:text-[color:var(--kohaku)]"
        >
          See the trend
        </Link>
      </p>
    </div>
  );
}
