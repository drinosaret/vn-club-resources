'use client';

import { Loader2 } from 'lucide-react';

import { LeaderboardTable } from '@/components/rankings/LeaderboardTable';
import { formatMetricValue, METRIC_DISPLAY } from '@/lib/browse-metrics';
import type { BrowseMetric } from '@/lib/browse-metrics';
import type { LeaderboardRow, VNSearchResult } from '@/lib/vndb-stats-api';

/**
 * Browse results as a ranking.
 *
 * Renders through the same table the catalogue boards use, so numbering, covers, VNDB links
 * and the title preference all behave identically on both surfaces. What browse supplies
 * that a board does not is the filter set, which is the whole point: the reader poses the
 * question and gets it answered in the form the boards use.
 */

interface RankedResultsProps {
  results: VNSearchResult[];
  /** Rank of the first row, so numbering runs on across pages instead of restarting. */
  startRank: number;
  metric: BrowseMetric | null;
  isLoading?: boolean;
}

/** The value shown at the end of each row: the ranking metric, or the rating by default. */
function valueLabel(vn: VNSearchResult, metric: BrowseMetric | null): string {
  const formatted = formatMetricValue(metric, vn.metric_value);
  if (formatted !== null) return formatted;
  return vn.rating ? vn.rating.toFixed(2) : '';
}

function toRow(vn: VNSearchResult, rank: number, metric: BrowseMetric | null): LeaderboardRow {
  const id = vn.id.startsWith('v') ? vn.id : `v${vn.id}`;
  return {
    rank,
    id,
    label: vn.title,
    // The year, which is what the grid shows under a cover and the only other field browse
    // has for every result.
    sublabel: vn.released ? vn.released.substring(0, 4) : null,
    title_jp: vn.title_jp ?? null,
    title_romaji: vn.title_romaji ?? null,
    href: `/vn/${id}`,
    image_url: vn.image_url ?? null,
    image_sexual: vn.image_sexual ?? null,
    image_vn_id: id,
    value: vn.metric_value ?? vn.rating ?? 0,
    value_label: valueLabel(vn, metric),
  };
}

export function RankedResults({ results, startRank, metric, isLoading }: RankedResultsProps) {
  const rows = results.map((vn, index) => toRow(vn, startRank + index, metric));

  return (
    <div className="relative">
      {isLoading && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-white/60 dark:bg-gray-900/60">
          <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
        </div>
      )}
      <LeaderboardTable
        rows={rows}
        emptyMessage={
          metric
            ? `No titles meet the sample floor for ${METRIC_DISPLAY[metric].label.toLowerCase()} with these filters.`
            : 'No titles match these filters.'
        }
      />
    </div>
  );
}
