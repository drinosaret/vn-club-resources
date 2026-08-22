'use client';

import { useMemo } from 'react';
import { Fingerprint } from 'lucide-react';

import { RadarChart } from '@/components/charts/RadarChart';
import { computeFingerprint, describeFingerprint } from '@/lib/taste-fingerprint';

/**
 * The shape of a reader's taste, on six axes.
 *
 * Everything comes from stats the page already holds, so this adds no request. It is a
 * different reading of the same numbers rather than new data: the distributions elsewhere on
 * the page answer "what have you read", and this answers "what kind of reader are you".
 */

interface TasteFingerprintProps {
  averageScore: number | null;
  completed: number;
  totalOnList: number;
  releaseYears: Record<string, number>;
  /** Either the plain counts or the detailed buckets; both are handled. */
  lengths: Record<string, number | { count: number }>;
  ageRatings: Record<string, number | { count: number }>;
  topTagWeights: number[];
}

/** The length and age distributions arrive either as counts or as objects, by endpoint. */
function toCounts(source: Record<string, number | { count: number }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    counts[key] = typeof value === 'number' ? value : (value?.count ?? 0);
  }
  return counts;
}

export function TasteFingerprint({
  averageScore,
  completed,
  totalOnList,
  releaseYears,
  lengths,
  ageRatings,
  topTagWeights,
}: TasteFingerprintProps) {
  const axes = useMemo(
    () =>
      computeFingerprint({
        averageScore,
        completed,
        totalOnList,
        releaseYears: releaseYears ?? {},
        lengths: toCounts(lengths),
        ageRatings: toCounts(ageRatings),
        topTagWeights,
        currentYear: new Date().getFullYear(),
      }),
    [averageScore, completed, totalOnList, releaseYears, lengths, ageRatings, topTagWeights],
  );

  const available = axes.filter((axis) => axis.available);

  // A radar needs at least three axes to be a shape rather than a line.
  if (available.length < 3) return null;

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white mb-1">
        <Fingerprint className="w-4 h-4 text-gray-400" />
        Your taste fingerprint
      </h2>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
        {describeFingerprint(available) ||
          'Six readings of your list, each on its own scale.'}
      </p>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="shrink-0">
          <RadarChart axes={available} />
        </div>

        {/* The chart carries the shape; this carries the numbers. Reading a value off a
            radar is guesswork, and a hover target does not exist on a
            phone, so every score is written out with what it amounts to. */}
        <dl className="min-w-0 flex-1 space-y-2 sm:max-w-xl">
          {available.map((axis) => (
            <div key={axis.key} className="min-w-0">
              {/* The score leads the row. Held to the far end of a wide card it sits a
                  paragraph's width from the label it belongs to, with nothing between them
                  to carry the eye across; the cards that do put a value on the right run a
                  bar under it for exactly that reason. Untinted, because these axes have no
                  better and worse end: a low adult-content score is not a poor result. */}
              <dt className="flex items-baseline gap-3">
                <span className="w-11 shrink-0 rounded-md bg-gray-100 px-2 py-0.5 text-center text-sm font-semibold tabular-nums text-gray-700 dark:bg-gray-700/50 dark:text-gray-200">
                  {Math.round(axis.value)}
                </span>
                <span className="min-w-0 text-sm font-medium text-gray-700 dark:text-gray-300">
                  {axis.label}
                </span>
              </dt>
              {/* Indented past the badge so the sentence lines up under its own label. */}
              <dd className="mt-0.5 pl-14 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {axis.detail}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <details className="mt-4 group">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 py-1.5 text-[11px] font-medium text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
          <span className="transition-transform group-open:rotate-90">&rsaquo;</span>
          How each score is worked out
        </summary>
        <dl className="mt-1 space-y-1.5 border-t border-gray-200/70 pt-2 dark:border-gray-700/70">
          {available.map((axis) => (
            <div key={axis.key} className="flex flex-wrap gap-x-2 text-[11px]">
              <dt className="font-medium text-gray-600 dark:text-gray-300">{axis.label}</dt>
              <dd className="min-w-0 flex-1 text-gray-500 dark:text-gray-400">
                {axis.formula}
                {axis.working ? (
                  <>
                    {' '}
                    <span className="whitespace-nowrap font-mono text-gray-400 dark:text-gray-500">
                      {axis.working}
                    </span>
                  </>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
          Each score stands on its own scale rather than against other readers, so a 40 means
          the same thing on your list next year as it does today.
        </p>
      </details>
    </div>
  );
}
