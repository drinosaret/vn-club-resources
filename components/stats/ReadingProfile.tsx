'use client';

import { Compass } from 'lucide-react';

import Link from 'next/link';

import { useReadingProfile } from '@/lib/use-reading-profile';
import type { DriftHalf, MilestonePoint } from '@/lib/vndb-stats-api';
import { getDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import { counted, plural } from '@/lib/plural';
import type { TitlePreference } from '@/lib/title-preference';

/**
 * Three things about a reader that need everybody else's votes to answer.
 *
 * The rest of this page describes one list: what is in it, how long, how highly rated. These
 * three only exist because the whole vote record is here, which is what no tracker built on
 * an API can do. Each is a sentence rather than a chart, because each is one number and a
 * chart of one number is decoration.
 */

interface ReadingProfileProps {
  uid: string;
}

/** The title form the reader has asked for, from the three the endpoint sends. */
function milestoneTitle(point: MilestonePoint, preference: TitlePreference): string {
  return getDisplayTitle(
    {
      title: point.title,
      title_jp: point.title_jp ?? undefined,
      title_romaji: point.title_romaji ?? undefined,
    },
    preference,
  );
}

/** Phrase a percentile the way someone would say it out loud. */
function standing(percentile: number | null, high: string, low: string): string | null {
  if (percentile === null) return null;
  if (percentile >= 99.5) return `${high} than 99% of readers`;
  if (percentile >= 50) return `${high} than ${Math.round(percentile)}% of readers`;
  return `${low} than ${Math.round(100 - percentile)}% of readers`;
}

/** "3 Feb 2009", unambiguous in any locale and short enough to sit inline. */
/**
 * The band a reader's ratings usually fall in, relative to everyone else.
 *
 * The gap from the community has an average and a spread, and neither means much alone: an
 * average of half a point is a different reader depending on whether it holds steady or
 * swings two points either way. Stating the two as one range is the only form of this that
 * says what it represents without asking anyone to hold a distribution in their head.
 */
function gapBand(rawBias: number, rawSpread: number): string {
  // Added from the two figures as printed, not from more precision than those show, so a
  // reader who adds them up gets the bound they are looking at.
  const bias = Number(rawBias.toFixed(2));
  const spread = Number(rawSpread.toFixed(2));
  const low = bias - spread;
  const high = bias + spread;
  const near = Math.abs(low) < Math.abs(high) ? low : high;
  const far = near === low ? high : low;

  if (low < 0 && high > 0) {
    return `from ${Math.abs(low).toFixed(2)} points below to ${high.toFixed(2)} above`;
  }
  const side = high <= 0 ? 'below' : 'above';
  return `between ${Math.abs(near).toFixed(2)} and ${Math.abs(far).toFixed(2)} points ${side}`;
}

function shortDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The axes worth showing movement on, and how to phrase each.
 *
 * Kept to measures the rest of the page already states about a reader. The tag-level version
 * of this works but its strongest signal is an inference nobody should publish about a named
 * person, and these pages are public.
 */
const DRIFT_AXES: Array<{
  key: keyof DriftHalf;
  label: string;
  unit: 'percent' | 'score';
}> = [
  { key: 'near_release', label: 'Rated within two years of release', unit: 'percent' },
  { key: 'long_titles', label: 'Long titles', unit: 'percent' },
  { key: 'adult', label: 'Adult-rated', unit: 'percent' },
  { key: 'average', label: 'Average rating', unit: 'score' },
];

/** Movement worth mentioning. Below this the two halves are telling the same story. */
const DRIFT_THRESHOLD = { percent: 3, score: 0.15 };

function Line({
  figure,
  children,
  aside,
}: {
  figure: string;
  children: React.ReactNode;
  aside?: string | null;
}) {
  // A fixed first column rather than one sized to its contents. These figures range from a
  // two-digit count to a nine-character year span, so a figure set inline leaves every
  // sentence starting wherever the number before it happened to end, and a column of facts
  // reads as five unrelated fragments. The width is set by the widest figure the card can
  // produce. It must not be `auto`: that resolves per grid, so the two columns at `lg` would
  // size themselves independently and the figures would not line up across them.
  return (
    <div className="grid grid-cols-[6rem_1fr] items-baseline gap-x-3">
      <span className="text-right text-lg font-semibold tabular-nums text-gray-900 dark:text-white">
        {figure}
      </span>
      <div className="min-w-0">
        <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">{children}</p>
        {/* Its own line. Run on after the sentence it qualifies, it wraps on most widths
            and reads as a fragment left over from the line above. */}
        {aside ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
            {aside}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Shared titles needed before a percentile is quoted about the reader's habits. */
const MIN_COMPARABLE_FOR_STANDING = 5;

export function ReadingProfile({ uid }: ReadingProfileProps) {
  const { profile: data, loading } = useReadingProfile(uid);
  const { preference } = useTitlePreference();

  if (loading) return <div className="h-96 rounded-xl image-placeholder" />;
  // A reader with no public votes has nothing to compare, which is a real state rather than
  // a failure, and an empty card would only take up room.
  if (!data || !data.rated) return null;

  // A placing against the whole population needs a list worth placing. Below this the
  // figures are still true about the reader, but calling one shared title "harsher than 97%
  // of readers" states a habit on the evidence of a single opinion.
  const enoughToPlace = data.comparable >= MIN_COMPARABLE_FOR_STANDING;
  const obscurity = enoughToPlace
    ? standing(data.percentiles?.obscurity ?? null, 'further off the map', 'closer to the canon')
    : null;
  const bias = enoughToPlace
    ? standing(data.percentiles?.bias ?? null, 'more generous', 'harsher')
    : null;

  return (
    <div className="rounded-xl border border-gray-200/60 bg-white p-5 shadow-md shadow-gray-200/50 dark:border-gray-700/80 dark:bg-gray-800 dark:shadow-none">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
        <Compass className="h-4 w-4 text-gray-400" />
        Against everyone else
      </h2>
      <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">
        Answered from every public vote on VNDB, not just your own list.
      </p>

      {/* Two columns on a wide screen and one on a narrow one, so no fact may lean on the
          one printed next to it: whichever row sits above a given fact changes with the
          width. Each sentence names its own quantity outright. */}
      <div className="grid gap-x-8 gap-y-3 lg:grid-cols-2">
        {data.sole_voter > 0 ? (
          <Line figure={data.sole_voter.toLocaleString()}>
            {data.sole_voter === 1
              ? 'title you are the only person to have rated.'
              : 'titles you are the only person to have rated.'}
          </Line>
        ) : null}

        {data.median_other_voters !== null ? (
          <Line figure={data.median_other_voters.toLocaleString()} aside={obscurity}>
            other voters on a typical title you have read.
          </Line>
        ) : null}

        {data.bias !== null ? (
          <Line
            figure={`${data.bias > 0 ? '+' : ''}${data.bias.toFixed(2)}`}
            aside={bias}
          >
            rating points away from the community on the{' '}
            {counted(data.comparable, 'title', 'titles')} you share with them.
          </Line>
        ) : null}

        {/* Withheld when the band collapses to a single year. "2004 to 2004, centred on
            2004" describes one title three times over and calls it a distribution. */}
        {data.era_from !== null && data.era_to !== null && data.era_from !== data.era_to ? (
          <Line figure={`${data.era_from}–${data.era_to}`}>
            the years holding the middle 80% of what you read, centred on {data.era_median}. A
            band rather than an average, which a handful of outliers would drag around.
          </Line>
        ) : null}

        {data.divergence !== null && data.bias !== null ? (
          <Line figure={`±${data.divergence.toFixed(2)}`}>
            how much your distance from the community varies from one title to the next. On
            most titles your rating lands {gapBand(data.bias, data.divergence)} it.
          </Line>
        ) : null}
      </div>

      <div className="mt-4 grid gap-x-8 gap-y-4 border-t border-gray-200/70 pt-3 dark:border-gray-700/70 lg:grid-cols-2">
      {data.drift
        ? (() => {
            const moved = DRIFT_AXES.map((axis) => {
              const from = data.drift!.early[axis.key] as number | null;
              const to = data.drift!.late[axis.key] as number | null;
              if (from === null || to === null) return null;
              const delta = to - from;
              if (Math.abs(delta) < DRIFT_THRESHOLD[axis.unit]) return null;
              return { ...axis, from, to, delta };
            }).filter(Boolean) as Array<{
              label: string; unit: 'percent' | 'score'; from: number; to: number; delta: number;
            }>;

            if (!moved.length) return null;
            const fmt = (v: number, unit: 'percent' | 'score') =>
              unit === 'percent' ? `${Math.round(v)}%` : v.toFixed(2);

            return (
              <div>
                <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                  How this changed
                </p>
                <p className="mb-2 text-[11px] text-gray-400 dark:text-gray-500">
                  Your first {data.drift!.early.titles.toLocaleString()} ratings against your
                  most recent {data.drift!.late.titles.toLocaleString()}. Only measures that
                  moved are listed.
                </p>
                <ul className="space-y-1">
                  {moved.map((axis) => (
                    <li
                      key={axis.label}
                      className="flex flex-wrap items-baseline gap-x-2 text-xs text-gray-500 dark:text-gray-400"
                    >
                      <span className="text-gray-700 dark:text-gray-300">{axis.label}</span>
                      <span className="tabular-nums">
                        {fmt(axis.from, axis.unit)} &rarr; {fmt(axis.to, axis.unit)}
                      </span>
                      <span
                        className={
                          axis.delta > 0
                            ? 'tabular-nums text-emerald-600 dark:text-emerald-400'
                            : 'tabular-nums text-amber-600 dark:text-amber-400'
                        }
                      >
                        {axis.delta > 0 ? '+' : ''}
                        {fmt(axis.delta, axis.unit)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()
        : null}

      {data.milestones?.first && data.milestones.latest ? (
        <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <p>
            {data.milestones.first.href === data.milestones.latest.href &&
            data.milestones.first.date === data.milestones.latest.date ? (
              <>
                {/* One rating is both ends of the history. Naming it twice with the same
                    date reads as two events. */}
                Your only rating so far is{' '}
                <Link
                  href={data.milestones.first.href}
                  className="text-primary-600 hover:underline dark:text-primary-400"
                >
                  {milestoneTitle(data.milestones.first, preference)}
                </Link>
                , on {shortDate(data.milestones.first.date)}.
              </>
            ) : (
              <>
                You started on {shortDate(data.milestones.first.date)} with{' '}
                <Link
                  href={data.milestones.first.href}
                  className="text-primary-600 hover:underline dark:text-primary-400"
                >
                  {milestoneTitle(data.milestones.first, preference)}
                </Link>
                , and your most recent was{' '}
                <Link
                  href={data.milestones.latest.href}
                  className="text-primary-600 hover:underline dark:text-primary-400"
                >
                  {milestoneTitle(data.milestones.latest, preference)}
                </Link>{' '}
                on {shortDate(data.milestones.latest.date)}.
              </>
            )}
          </p>
          <p>
            {counted(data.milestones.active_days, 'day', 'days')} with a rating on{' '}
            {plural(data.milestones.active_days, 'it', 'them')}
            {data.milestones.longest_gap_days
              ? `, and the longest quiet stretch between two was ${counted(data.milestones.longest_gap_days, 'day', 'days')}.`
              : '.'}
          </p>
        </div>
      ) : null}
      </div>
    </div>
  );
}
