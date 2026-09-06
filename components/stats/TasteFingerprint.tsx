'use client';

import { useMemo } from 'react';

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
    <div className="st-card p-5">
      <h2 className="st-card-title mb-1">
        Your taste fingerprint
      </h2>
      <p className="st-card-sub mb-3">
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
                <span className="st-num w-11 shrink-0 text-right text-sm text-[color:var(--ink)]">
                  {Math.round(axis.value)}
                </span>
                <span className="min-w-0 text-sm font-medium text-[color:var(--text-secondary)]">
                  {axis.label}
                </span>
              </dt>
              {/* Indented past the badge so the sentence lines up under its own label. */}
              <dd className="mt-0.5 pl-14 text-xs leading-relaxed text-[color:var(--nezu)]">
                {axis.detail}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <details className="mt-4 group">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 py-1.5 text-[11px] font-medium text-[color:var(--text-faint)] transition-colors hover:text-[color:var(--nezu)]">
          <span className="transition-transform group-open:rotate-90">&rsaquo;</span>
          How each score is worked out
        </summary>
        <dl className="mt-1 space-y-1.5 border-t border-[color:var(--rule)] pt-2">
          {available.map((axis) => (
            <div key={axis.key} className="flex flex-wrap gap-x-2 text-[11px]">
              <dt className="font-medium text-[color:var(--nezu)]">{axis.label}</dt>
              <dd className="min-w-0 flex-1 text-[color:var(--nezu)]">
                {axis.formula}
                {axis.working ? (
                  <>
                    {' '}
                    <span className="whitespace-nowrap font-mono text-[color:var(--text-faint)]">
                      {axis.working}
                    </span>
                  </>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--text-faint)]">
          Each score stands on its own scale rather than against other readers, so a 40 means
          the same thing on your list next year as it does today.
        </p>
      </details>
    </div>
  );
}
