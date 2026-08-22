'use client';

import { Activity, Info } from 'lucide-react';

interface CompareCompatibilityProps {
  jaccardSimilarity: number | null;
  ratingAgreement: number | null;
  tagSimilarity: number | null;
  /** Pearson correlation over shared rated titles, or null when it is undefined. */
  scoreCorrelation: number | null;
  sharedVNs: number;
}

/**
 * The individual metrics behind the headline compatibility score, each on a 0-100% bar.
 *
 * Every metric is optional: two readers can share a list overlap but no rated titles, or
 * rated titles but no tag data, and a bar that cannot be computed is left out rather than
 * drawn at a default value.
 */
export function CompareCompatibility({
  jaccardSimilarity,
  ratingAgreement,
  tagSimilarity,
  scoreCorrelation,
  sharedVNs,
}: CompareCompatibilityProps) {
  if (jaccardSimilarity == null && tagSimilarity == null) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="flex items-center gap-2 mb-2">
        <Activity className="w-5 h-5 text-primary-500" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Compatibility Breakdown
        </h3>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Individual metrics that make up the compatibility score. Hover over the <Info className="w-3 h-3 inline" /> icons for calculation details.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {jaccardSimilarity != null && (
          <MetricBar
            label="List Overlap"
            value={jaccardSimilarity}
            description="VNs in common"
            tooltip="Jaccard similarity: (shared VNs) / (total unique VNs between both users). Higher = more overlap in what you've read."
            showRawCount={sharedVNs}
          />
        )}
        {ratingAgreement != null && (
          <MetricBar
            label="Rating Agreement"
            value={ratingAgreement}
            description="Score closeness on shared VNs"
            tooltip="How close your actual scores are on shared VNs. If you both give a VN an 8, that's high agreement. 100% = identical scores, 0% = average 5+ point difference."
          />
        )}
        {tagSimilarity != null && (
          <MetricBar
            label="Tag Preferences"
            value={tagSimilarity}
            description="Similar tastes in genres"
            tooltip="Cosine similarity of tag preference vectors. Compares which genres/tags you rate highly, weighted by how many VNs you've read with each tag."
          />
        )}
        {scoreCorrelation != null && (
          <MetricBar
            label="Score Correlation"
            value={Math.max(0, (scoreCorrelation + 1) / 2)}
            description="Relative ranking similarity"
            tooltip="Whether you rank VNs in the same relative order (Pearson correlation). A harsh rater and a generous rater who agree on which VNs are better or worse will score high here, even if their absolute scores differ."
          />
        )}
      </div>
    </div>
  );
}

function MetricBar({
  label,
  value,
  description,
  tooltip,
  showRawCount,
}: {
  label: string;
  value: number;
  description: string;
  tooltip?: string;
  showRawCount?: number;
}) {
  const percent = Math.round(value * 100);
  const displayPercent = value > 0 && percent === 0 ? '< 1' : percent.toString();
  const barWidth = value > 0 && percent === 0 ? 1 : percent;
  const barColor = percent >= 60 ? 'bg-green-500' : percent >= 35 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="group relative">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
          {label}
          {tooltip && (
            <span className="cursor-help text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title={tooltip}>
              <Info className="w-3.5 h-3.5" />
            </span>
          )}
        </span>
        <span className="text-sm font-bold text-gray-900 dark:text-white">
          {displayPercent}%
          {showRawCount !== undefined && <span className="font-normal text-gray-500 ml-1">({showRawCount})</span>}
        </span>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>
    </div>
  );
}
