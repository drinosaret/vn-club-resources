'use client';

import { useState } from 'react';
import type { VNVoteStats as VNVoteStatsData } from '@/lib/vndb-stats-api';
import { VNVoteDistribution } from './VNVoteDistribution';
import { VNInsightCards } from './VNInsightCards';
import { VNComparativeContext } from './VNComparativeContext';

import { TrendLineChart } from '@/components/stats/TrendLineChart';
import { FadeIn } from '@/components/FadeIn';

interface VNVoteStatsProps {
  data: VNVoteStatsData | null;
  isLoading: boolean;
  error: boolean;
  totalVotecount?: number;
}

function ChartToggle({
  active,
  options,
  onChange,
}: {
  active: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex rounded-md bg-gray-100 dark:bg-gray-700/50 p-0.5 flex-shrink-0">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
            active === opt.value
              ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function VNVoteStats({ data, isLoading, error, totalVotecount }: VNVoteStatsProps) {
  const [votesMode, setVotesMode] = useState<'cumulative' | 'monthly'>('cumulative');
  const [scoreMode, setScoreMode] = useState<'cumulative' | 'monthly'>('cumulative');

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-20 rounded-xl bg-gray-100 dark:bg-gray-800" />
        <div className="h-48 rounded-xl bg-gray-100 dark:bg-gray-800" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
        <div className="h-52 rounded-xl bg-gray-100 dark:bg-gray-800" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        Vote statistics are not available for this visual novel.
      </div>
    );
  }

  if (data.total_votes === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        No votes recorded for this visual novel yet.
      </div>
    );
  }

  const formatMonth = (month: string) => {
    if (!month || month.length < 7) return month;
    const [year, monthNum] = month.split('-');
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${names[parseInt(monthNum, 10) - 1]} '${year.slice(-2)}`;
  };

  const toggleOptions = [
    { value: 'cumulative', label: 'Cumulative' },
    { value: 'monthly', label: 'Monthly' },
  ];

  return (
    <FadeIn duration={250} slideUp={false}>
    <div className="space-y-6">
      {/* 1. Comparative Context */}
      {data.context && <VNComparativeContext context={data.context} />}

      {/* 2. Vote Distribution */}
      <VNVoteDistribution
        distribution={data.score_distribution}
        average={data.average_score}
        totalVotes={totalVotecount ?? data.total_votes}
        publicVotes={data.total_votes}
      />

      {/* 3. At-a-Glance Insight Cards */}
      <VNInsightCards
        scoreDistribution={data.score_distribution}
        scoreOverTime={data.score_over_time}
        votesOverTime={data.votes_over_time}
        rating={data.average_score}
        votecount={totalVotecount ?? data.total_votes}
        globalMedians={data.global_medians}
      />

      {/* 4. Votes Over Time */}
      {data.votes_over_time.length > 1 && (
        <TrendLineChart
          data={data.votes_over_time}
          dataKey={votesMode === 'cumulative' ? 'cumulative' : 'count'}
          xAxisKey="month"
          title="Votes Over Time"
          subtitle={votesMode === 'cumulative' ? 'Cumulative vote count by month' : 'New votes per month'}
          color="#8b5cf6"
          areaFill={votesMode === 'cumulative'}
          formatValue={(v) => v.toLocaleString()}
          formatXAxis={formatMonth}
          height={200}
          headerRight={
            <ChartToggle
              active={votesMode}
              options={toggleOptions}
              onChange={(v) => setVotesMode(v as 'cumulative' | 'monthly')}
            />
          }
        />
      )}

      {/* 5. Score Over Time */}
      {data.score_over_time.length > 1 && (
        <TrendLineChart
          data={data.score_over_time}
          dataKey={scoreMode === 'cumulative' ? 'cumulative_avg' : 'avg_score'}
          xAxisKey="month"
          title="Average Score Over Time"
          subtitle={scoreMode === 'cumulative' ? 'Running average score (1-10 scale)' : 'Average score of votes that month'}
          color="#f59e0b"
          areaFill={false}
          formatValue={(v) => v.toFixed(2)}
          formatXAxis={formatMonth}
          height={200}
          headerRight={
            <ChartToggle
              active={scoreMode}
              options={toggleOptions}
              onChange={(v) => setScoreMode(v as 'cumulative' | 'monthly')}
            />
          }
        />
      )}
    </div>
    </FadeIn>
  );
}
