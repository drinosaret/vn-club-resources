'use client';

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  useJitenAll,
  useJitenSimilarDifficulty,
  useJitenSimilarLength,
  type JitenDeckDto,
  type JitenDetailResponse,
  type JitenDifficultyResponse,
  type JitenCoveragePoint,
} from '@/lib/jiten-hooks';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { NSFWImage } from '@/components/NSFWImage';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  type TooltipProps,
} from 'recharts';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';


// ──────────── Types ────────────

interface SimilarDifficultyVN {
  vnId: string;
  title: string;
  titleJp: string;
  difficulty: number;
  coverUrl: string | null;
  imageSexual?: number;
}

interface SimilarLengthVN {
  vnId: string;
  title: string;
  titleJp: string;
  characterCount: number;
  difficulty: number;
  coverUrl: string | null;
  imageSexual?: number;
}

// ──────────── Props ────────────

interface VNLanguageStatsProps {
  vnId: string;
  deckId?: number;
}

// ──────────── Helpers ────────────

function getDifficultyColor(difficulty: number): string {
  if (difficulty <= 1.5) return '#22c55e';
  if (difficulty <= 2.5) return '#3b82f6';
  if (difficulty <= 3.5) return '#f59e0b';
  if (difficulty <= 4.5) return '#f97316';
  return '#ef4444';
}

function getDifficultyLabel(difficulty: number): string {
  if (difficulty <= 1.5) return 'Beginner';
  if (difficulty <= 2.5) return 'Easy';
  if (difficulty <= 3.5) return 'Intermediate';
  if (difficulty <= 4.5) return 'Hard';
  return 'Expert';
}

function getLengthColor(chars: number): string {
  if (chars <= 100_000) return '#22c55e';
  if (chars <= 300_000) return '#3b82f6';
  if (chars <= 600_000) return '#f59e0b';
  if (chars <= 1_000_000) return '#f97316';
  return '#ef4444';
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

function interpolateCoverage(curve: JitenCoveragePoint[], wordCount: number): number | null {
  if (!curve.length) return null;
  if (wordCount <= curve[0].rank) return curve[0].coverage;
  if (wordCount >= curve[curve.length - 1].rank) return curve[curve.length - 1].coverage;
  for (let i = 0; i < curve.length - 1; i++) {
    if (wordCount >= curve[i].rank && wordCount <= curve[i + 1].rank) {
      const t = (wordCount - curve[i].rank) / (curve[i + 1].rank - curve[i].rank);
      return Math.round(curve[i].coverage + t * (curve[i + 1].coverage - curve[i].coverage));
    }
  }
  return null;
}


// ──────────── Reading Style Classification ────────────

interface ReadingStyle {
  label: string;
  description: string;
  criteria: string;
  color: string;
  bgClass: string;
}

function classifyReadingStyle(deck: JitenDeckDto): ReadingStyle {
  const hasDialogue = !deck.hideDialoguePercentage && deck.dialoguePercentage > 0;
  const isConversational = hasDialogue && deck.dialoguePercentage > 50;
  const isDense = deck.difficultyRaw > 3 || deck.averageSentenceLength > 20;

  // When dialogue data is unavailable, classify on difficulty/sentence length only
  if (!hasDialogue) {
    if (!isDense) return {
      label: 'Approachable',
      description: 'Short sentences with accessible vocabulary',
      criteria: 'Difficulty ≤ 3.0 · Sentence length ≤ 20',
      color: '#3b82f6',
      bgClass: 'from-blue-50 to-sky-50 dark:from-blue-950/30 dark:to-sky-950/20 border-blue-200/50 dark:border-blue-800/40',
    };
    return {
      label: 'Demanding',
      description: 'Long sentences with complex vocabulary',
      criteria: 'Difficulty > 3.0 or Sentence length > 20',
      color: '#a855f7',
      bgClass: 'from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-950/20 border-purple-200/50 dark:border-purple-800/40',
    };
  }

  if (isConversational && !isDense) return {
    label: 'Conversational',
    description: 'Dialogue-driven with everyday language',
    criteria: 'Dialogue > 50% · Difficulty ≤ 3.0 · Sentence length ≤ 20',
    color: '#22c55e',
    bgClass: 'from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/20 border-green-200/50 dark:border-green-800/40',
  };
  if (isConversational && isDense) return {
    label: 'Elaborate',
    description: 'Dialogue-driven with complex vocabulary and long sentences',
    criteria: 'Dialogue > 50% · Difficulty > 3.0 or Sentence length > 20',
    color: '#f59e0b',
    bgClass: 'from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/20 border-amber-200/50 dark:border-amber-800/40',
  };
  if (!isConversational && !isDense) return {
    label: 'Flowing',
    description: 'Narration-driven with approachable language',
    criteria: 'Dialogue ≤ 50% · Difficulty ≤ 3.0 · Sentence length ≤ 20',
    color: '#3b82f6',
    bgClass: 'from-blue-50 to-sky-50 dark:from-blue-950/30 dark:to-sky-950/20 border-blue-200/50 dark:border-blue-800/40',
  };
  return {
    label: 'Literary',
    description: 'Narration-driven with complex vocabulary or lengthy prose',
    criteria: 'Dialogue ≤ 50% · Difficulty > 3.0 or Sentence length > 20',
    color: '#a855f7',
    bgClass: 'from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-950/20 border-purple-200/50 dark:border-purple-800/40',
  };
}

// ──────────── Radar Normalization ────────────

// ──────────── Lightweight Radar (replaces Recharts RadarChart ~90 SVG → ~15) ────────────

const RADAR_CX = 150;
const RADAR_CY = 150;
const RADAR_R = 100;
const RADAR_LEVELS = [0.25, 0.5, 0.75, 1];
const LABEL_OFFSET = 22;

function vertex(cx: number, cy: number, r: number, i: number, n: number) {
  const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
}

function polygonPoints(cx: number, cy: number, r: number, n: number) {
  return Array.from({ length: n }, (_, i) => vertex(cx, cy, r, i, n))
    .map(([x, y]) => `${x},${y}`)
    .join(' ');
}

function SimpleRadar({ data }: { data: Array<{ axis: string; value: number }> }) {
  const n = data.length;
  const dataPoints = data
    .map((d, i) => vertex(RADAR_CX, RADAR_CY, RADAR_R * (d.value / 100), i, n))
    .map(([x, y]) => `${x},${y}`)
    .join(' ');

  return (
    <svg viewBox="0 0 300 300" className="w-full max-h-[300px]" aria-label="Text profile radar chart">
      {/* Grid polygons */}
      {RADAR_LEVELS.map(level => (
        <polygon
          key={level}
          points={polygonPoints(RADAR_CX, RADAR_CY, RADAR_R * level, n)}
          fill="none"
          className="stroke-gray-200 dark:stroke-gray-700"
          strokeWidth={1}
        />
      ))}
      {/* Axis lines */}
      {data.map((_, i) => {
        const [x, y] = vertex(RADAR_CX, RADAR_CY, RADAR_R, i, n);
        return <line key={i} x1={RADAR_CX} y1={RADAR_CY} x2={x} y2={y} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth={1} />;
      })}
      {/* Data polygon */}
      <polygon
        points={dataPoints}
        stroke="#6366f1"
        fill="#6366f1"
        fillOpacity={0.15}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {/* Axis labels */}
      {data.map((d, i) => {
        const [x, y] = vertex(RADAR_CX, RADAR_CY, RADAR_R + LABEL_OFFSET, i, n);
        const lines = d.axis.split('\n');
        return (
          <text
            key={d.axis}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-gray-500 dark:fill-gray-400"
            fontSize={11}
          >
            {lines.length > 1
              ? lines.map((line, li) => (
                  <tspan key={li} x={x} dy={li === 0 ? `-${(lines.length - 1) * 0.5}em` : '1.1em'}>
                    {line}
                  </tspan>
                ))
              : d.axis}
          </text>
        );
      })}
    </svg>
  );
}

function buildRadarData(deck: JitenDeckDto, label?: string) {
  const axes = [
    { axis: 'Difficulty', value: (deck.difficultyRaw / 5) * 100, ...(label && { label }) },
    { axis: 'Unique\nWords', value: Math.min((deck.uniqueWordCount / 25000) * 100, 100) },
    ...(!deck.hideDialoguePercentage && deck.dialoguePercentage > 0 ? [{ axis: 'Dialogue', value: deck.dialoguePercentage }] : []),
    { axis: 'Sentence\nLength', value: Math.min((deck.averageSentenceLength / 30) * 100, 100) },
    { axis: 'Volume', value: Math.min((deck.characterCount / 1_000_000) * 100, 100) },
  ];
  return axes;
}

// ──────────── Main Component ────────────

export function VNLanguageStats({ vnId, deckId }: VNLanguageStatsProps) {
  const { data: allData, error: allError, isLoading: allLoading } = useJitenAll(vnId);

  const detail = allData?.detail ?? null;
  const difficulty = allData?.difficulty ?? null;
  const coverage = allData?.coverage ?? null;

  const deck = detail?.mainDeck ?? detail?.parentDeck ?? null;
  const difficultyRaw = deck?.difficultyRaw;

  // Defer Recharts AreaCharts (DifficultyFlow, CoverageCurve) + Similar sections
  // to render after the initial paint has settled. Recharts charts generate ~100 SVG
  // elements each + ResponsiveContainer double-render, which triggers Firefox WebRender
  // text re-rasterization (cover vote count blinks).
  const [deferredReady, setDeferredReady] = useState(false);
  useEffect(() => {
    if (!deck) { setDeferredReady(false); return; }
    const id = setTimeout(() => setDeferredReady(true), 200);
    return () => clearTimeout(id);
  }, [deck]);

  const { data: similarVNs } = useJitenSimilarDifficulty(vnId, difficultyRaw ?? null);
  const characterCount = deck?.characterCount;
  const { data: similarLengthVNs } = useJitenSimilarLength(vnId, characterCount ?? null);

  // Error: detail failed with no cached data
  if (allError && !allData) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        Language analysis data could not be loaded.
      </div>
    );
  }

  // Detail still loading — show full skeleton
  if (allLoading) return <LanguageStatsSkeleton />;

  // Detail loaded but no deck data
  if (!deck) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">No language data yet</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-5 text-center max-w-xs">
          This visual novel hasn&apos;t been analyzed on jiten.moe yet.
        </p>
        <a
          href="https://jiten.moe/decks/media?mediaType=7"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          Browse jiten.moe
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    );
  }

  const diff = difficulty;
  const cov = coverage;
  const similar = (similarVNs as SimilarDifficultyVN[] | null) ?? [];
  const similarLength = (similarLengthVNs as SimilarLengthVN[] | null) ?? [];
  const attributionHref = 'https://jiten.moe/decks/media?mediaType=7';

  return (
    <div className="space-y-6">
        {/* Text Profile (reading style + radar + raw values) */}
        <TextProfile deck={deck} />

        {/* Vocabulary Depth */}
        <VocabularyDepth deck={deck} />

        {/* Difficulty Progression — deferred to avoid Firefox text flicker */}
        {deferredReady && diff?.progression && diff.progression.length > 1 && (
          <DifficultyFlow segments={diff.progression} average={diff.difficulty} />
        )}

        {/* Coverage Curve — deferred */}
        {deferredReady && cov && cov.length > 2 && (
          <CoverageCurveChart data={cov} />
        )}

        {/* Similar Difficulty — deferred */}
        {deferredReady && similar.length > 0 && (
          <SimilarDifficultySection vns={similar} currentDifficulty={deck.difficultyRaw} />
        )}

        {/* Similar Length — deferred */}
        {deferredReady && similarLength.length > 0 && (
          <SimilarLengthSection vns={similarLength} currentCharCount={deck.characterCount} />
        )}

        {/* Attribution */}
        <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-200/60 dark:border-gray-700/60 bg-gray-50 dark:bg-gray-800/50 px-4 py-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">Language data provided by</span>
          <a
            href={attributionHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
          >
            jiten.moe
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
    </div>
  );
}

// ──────────── 1+2. Combined Text Profile ────────────

function TextProfile({ deck }: { deck: JitenDeckDto }) {
  const style = classifyReadingStyle(deck);

  const radarData = useMemo(() => buildRadarData(deck), [deck]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      {/* Reading style header */}
      <div className={`px-4 sm:px-5 py-4 border-b bg-gradient-to-r ${style.bgClass}`}>
        <div className="flex items-center gap-2.5 mb-1">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: style.color }}
          />
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            {style.label}
          </h3>
          <span className="relative group/tip">
            <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 cursor-help" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <span className="pointer-events-none absolute left-0 top-full mt-1.5 w-max max-w-[260px] rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-[11px] leading-relaxed px-3 py-2 opacity-0 group-hover/tip:opacity-100 transition-opacity z-20 shadow-lg">
              <span className="font-medium block mb-1">Classification criteria</span>
              {style.criteria}
            </span>
          </span>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {style.description}
        </p>
      </div>

      <div className="p-4 sm:p-5">
        {/* Radar chart — lightweight custom SVG (replaces Recharts RadarChart) */}
        <SimpleRadar data={radarData} />

        {/* Raw values — labels match radar axes */}
        <div className={`grid ${(deck.hideDialoguePercentage || deck.dialoguePercentage === 0) ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3 sm:grid-cols-5'} gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700/60`}>
          {[
            { label: 'Difficulty', value: `${deck.difficultyRaw.toFixed(1)}/5` },
            { label: 'Unique Words', value: formatCount(deck.uniqueWordCount) },
            ...(!deck.hideDialoguePercentage && deck.dialoguePercentage > 0 ? [{ label: 'Dialogue', value: `${Math.round(deck.dialoguePercentage)}%` }] : []),
            { label: 'Sentence Length', value: `${deck.averageSentenceLength.toFixed(1)} w/s` },
            { label: 'Volume', value: `${formatCount(deck.characterCount)} chars` },
          ].map(stat => (
            <div key={stat.label} className="text-center">
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">{stat.label}</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ──────────── 3. Difficulty Progression Chart ────────────

function DifficultyTooltip(props: TooltipProps<number, string>) {
  const { active, payload, label } = props as { active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string };
  if (!active || !payload?.length) return null;
  const avg = payload.find(p => p.dataKey === 'difficulty')?.value;
  const peak = payload.find(p => p.dataKey === 'peak')?.value;
  return (
    <div className="bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
      <p className="text-xs font-semibold text-gray-900 dark:text-white mb-0.5">
        Progress: {label}
      </p>
      {avg != null && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Avg: <span className="font-medium" style={{ color: getDifficultyColor(avg) }}>{avg.toFixed(2)}</span>
          {' · '}
          {getDifficultyLabel(avg)}
        </p>
      )}
      {peak != null && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Peak: <span className="font-medium" style={{ color: getDifficultyColor(peak) }}>{peak.toFixed(2)}</span>
        </p>
      )}
    </div>
  );
}

function DifficultyFlow({ segments, average }: { segments: Array<{ segment: number; difficulty: number; peak: number }>; average: number }) {
  const interpretation = useMemo(() => {
    if (segments.length < 2) return null;
    const mid = Math.floor(segments.length / 2);
    const firstHalf = segments.slice(0, mid).reduce((s, seg) => s + seg.difficulty, 0) / mid;
    const secondHalf = segments.slice(mid).reduce((s, seg) => s + seg.difficulty, 0) / (segments.length - mid);
    const diff = secondHalf - firstHalf;
    if (diff > 0.4) return 'Difficulty ramps up noticeably in later sections';
    if (diff < -0.4) return 'Starts harder and becomes easier as you progress';
    const variance = segments.reduce((s, seg) => s + Math.abs(seg.difficulty - average), 0) / segments.length;
    if (variance > 0.5) return 'Difficulty varies significantly across sections';
    return 'Difficulty stays fairly consistent throughout';
  }, [segments, average]);

  const chartData = useMemo(() =>
    segments.map(seg => ({
      label: `${Math.round(((seg.segment) / segments.length) * 100)}%`,
      difficulty: Number(seg.difficulty.toFixed(2)),
      peak: Number(seg.peak.toFixed(2)),
    })),
    [segments]
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-5 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Difficulty Progression</h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          Average and peak difficulty across sections of the game
        </p>
      </div>

      <ResponsiveContainer width="100%" height={200} className="[&_svg]:outline-none [&_svg_*]:outline-none [&_svg]:[-webkit-tap-highlight-color:transparent]">
        <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="peakRangeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="avgDiffGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            className="text-gray-500 dark:text-gray-400"
            axisLine={{ className: 'stroke-gray-200 dark:stroke-gray-700' }}
            tickLine={{ className: 'stroke-gray-200 dark:stroke-gray-700' }}
          />
          <YAxis
            domain={[0, 5]}
            ticks={[1, 2, 3, 4, 5]}
            tick={{ fontSize: 10 }}
            className="text-gray-500 dark:text-gray-400"
            axisLine={{ className: 'stroke-gray-200 dark:stroke-gray-700' }}
            tickLine={{ className: 'stroke-gray-200 dark:stroke-gray-700' }}
            width={30}
          />
          <Tooltip content={<DifficultyTooltip />} />
          <ReferenceLine
            y={average}
            stroke="#6366f1"
            strokeDasharray="6 3"
            strokeOpacity={0.5}
            label={{
              value: `Avg ${average.toFixed(1)}`,
              position: 'insideTopRight',
              fontSize: 9,
              className: 'fill-indigo-400 dark:fill-indigo-500',
            }}
          />
          {/* Peak range band */}
          <Area
            type="monotone"
            dataKey="peak"
            stroke="#f59e0b"
            strokeWidth={1}
            strokeOpacity={0.4}
            strokeDasharray="4 3"
            fill="url(#peakRangeGrad)"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          {/* Average difficulty line */}
          <Area
            type="monotone"
            dataKey="difficulty"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#avgDiffGrad)"
            dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-gray-400 dark:text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded-full bg-indigo-500" />
          Average
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded-full bg-amber-500 opacity-60" style={{ borderTop: '1px dashed' }} />
          Peak
        </span>
      </div>

      {/* Interpretation */}
      {interpretation && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 text-center italic">
          {interpretation}
        </p>
      )}
    </div>
  );
}

// ──────────── 4. Coverage Curve with Reference Lines ────────────

const WORD_MILESTONES = [1000, 3000, 5000, 10000];

function CoverageTooltip(props: TooltipProps<number, string>) {
  const { active, payload } = props as { active?: boolean; payload?: Array<{ payload: JitenCoveragePoint }> };
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
      <p className="text-sm font-semibold text-gray-900 dark:text-white">
        {point.coverage}% coverage
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        with {point.rank.toLocaleString()} words
      </p>
    </div>
  );
}

function CoverageCurveChart({ data }: { data: JitenCoveragePoint[] }) {
  const milestoneLabels = useMemo(() =>
    WORD_MILESTONES
      .filter(wc => wc <= data[data.length - 1]?.rank)
      .map(wc => ({
        words: wc,
        coverage: interpolateCoverage(data, wc),
      }))
      .filter(m => m.coverage !== null),
    [data]
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-5 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Coverage Curve</h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          How much of the text you&apos;ll understand based on vocabulary size
        </p>
      </div>
      <ResponsiveContainer width="100%" height={240} className="[&_svg]:outline-none [&_svg_*]:outline-none [&_svg]:[-webkit-tap-highlight-color:transparent]">
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="coverageGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
          <XAxis
            dataKey="rank"
            type="number"
            scale="log"
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 11 }}
            className="text-gray-500 dark:text-gray-400"
            axisLine={{ className: 'stroke-gray-200 dark:stroke-gray-700' }}
            tickLine={{ className: 'stroke-gray-200 dark:stroke-gray-700' }}
            tickFormatter={(v) => formatCount(v)}
            ticks={[1, 10, 100, 1000, 10000]}
            label={{ value: 'Words known', position: 'insideBottom', offset: -2, fontSize: 10, className: 'fill-gray-400 dark:fill-gray-500' }}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            className="text-gray-500 dark:text-gray-400"
            axisLine={{ className: 'stroke-gray-200 dark:stroke-gray-700' }}
            tickLine={{ className: 'stroke-gray-200 dark:stroke-gray-700' }}
            tickFormatter={(v) => `${v}%`}
            width={45}
            domain={[0, 100]}
          />
          <Tooltip content={<CoverageTooltip />} />
          {/* Word count milestone reference lines */}
          {milestoneLabels.map((m, i) => (
            <ReferenceLine
              key={m.words}
              x={m.words}
              stroke="#a78bfa"
              strokeDasharray="4 3"
              strokeOpacity={0.6}
              label={{
                value: `${formatCount(m.words)} → ${m.coverage}%`,
                position: 'insideTopRight',
                fontSize: 9,
                dy: i * 14,
                className: 'fill-violet-400 dark:fill-violet-500',
              }}
            />
          ))}
          <Area
            type="monotone"
            dataKey="coverage"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#coverageGrad)"
            dot={false}
            activeDot={{ r: 4, fill: '#6366f1' }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ──────────── 5. Vocabulary Depth ────────────

function VocabularyDepth({ deck }: { deck: JitenDeckDto }) {
  const coreWords = deck.uniqueWordCount - deck.uniqueWordUsedOnceCount;
  const coreWordsPct = deck.uniqueWordCount > 0
    ? Math.round((coreWords / deck.uniqueWordCount) * 100)
    : 0;
  const rareWordsPct = 100 - coreWordsPct;

  const coreKanji = deck.uniqueKanjiCount - deck.uniqueKanjiUsedOnceCount;
  const coreKanjiPct = deck.uniqueKanjiCount > 0
    ? Math.round((coreKanji / deck.uniqueKanjiCount) * 100)
    : 0;
  const rareKanjiPct = 100 - coreKanjiPct;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-5 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Vocabulary Depth</h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          How vocabulary and kanji are distributed across the text
        </p>
      </div>

      <div className="space-y-4">
        {/* Words bar */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Words</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {formatCount(deck.uniqueWordCount)} distinct
            </span>
          </div>
          <div className="flex rounded-lg overflow-hidden h-6">
            <div
              className="flex items-center justify-center text-[10px] font-medium text-white transition-all"
              style={{ width: `${coreWordsPct}%`, backgroundColor: '#6366f1' }}
            >
              {coreWordsPct > 15 && `${formatCount(coreWords)} recurring`}
            </div>
            <div
              className="flex items-center justify-center text-[10px] font-medium text-white/90 transition-all"
              style={{ width: `${rareWordsPct}%`, backgroundColor: '#a78bfa' }}
            >
              {rareWordsPct > 15 && `${formatCount(deck.uniqueWordUsedOnceCount)} one-off`}
            </div>
          </div>
          <div className="flex items-center justify-between mt-1 text-[10px] text-gray-400 dark:text-gray-500">
            <span>Recurring<span className="hidden sm:inline"> (2+ times)</span> · {coreWordsPct}%</span>
            <span>One-off<span className="hidden sm:inline"> (once)</span> · {rareWordsPct}%</span>
          </div>
        </div>

        {/* Kanji bar */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Kanji</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {formatCount(deck.uniqueKanjiCount)} distinct
            </span>
          </div>
          <div className="flex rounded-lg overflow-hidden h-6">
            <div
              className="flex items-center justify-center text-[10px] font-medium text-white transition-all"
              style={{ width: `${coreKanjiPct}%`, backgroundColor: '#14b8a6' }}
            >
              {coreKanjiPct > 15 && `${formatCount(coreKanji)} recurring`}
            </div>
            <div
              className="flex items-center justify-center text-[10px] font-medium text-white/90 transition-all"
              style={{ width: `${rareKanjiPct}%`, backgroundColor: '#5eead4' }}
            >
              {rareKanjiPct > 15 && `${formatCount(deck.uniqueKanjiUsedOnceCount)} one-off`}
            </div>
          </div>
          <div className="flex items-center justify-between mt-1 text-[10px] text-gray-400 dark:text-gray-500">
            <span>Recurring<span className="hidden sm:inline"> (2+ times)</span> · {coreKanjiPct}%</span>
            <span>One-off<span className="hidden sm:inline"> (once)</span> · {rareKanjiPct}%</span>
          </div>
        </div>

        {/* Repetition stat */}
        <div className="flex items-center justify-center gap-6 pt-3 border-t border-gray-100 dark:border-gray-700/60">
          <div className="text-center">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Total Words</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatCount(deck.wordCount)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Sentences</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatCount(deck.sentenceCount)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────── 6+7. Similar VN Card (shared) ────────────

function SimilarVNCard({ vnId, title, titleJp, coverUrl, imageSexual, badgeLabel, badgeColor }: {
  vnId: string;
  title: string;
  titleJp: string;
  coverUrl: string | null;
  imageSexual?: number;
  badgeLabel: string;
  badgeColor: string;
}) {
  const { preference } = useTitlePreference();
  const displayTitle = getDisplayTitle({ title, title_jp: titleJp }, preference);
  const [retryKey, setRetryKey] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, []);

  const handleImageError = useCallback(() => {
    if (retryCountRef.current < 2) {
      const delay = retryCountRef.current === 0 ? 2000 : 5000;
      retryCountRef.current++;
      setImageError(true);
      retryTimerRef.current = setTimeout(() => {
        setImageError(false);
        setImageLoaded(false);
        setRetryKey(prev => prev + 1);
      }, delay);
    } else {
      setImageError(true);
    }
  }, []);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  const baseUrl = coverUrl ? getProxiedImageUrl(coverUrl, { width: 256, vnId }) : null;
  const imageUrl = baseUrl && retryKey > 0
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}_r=${retryKey}`
    : baseUrl;
  const showImage = imageUrl && !imageError;

  return (
    <Link
      key={vnId}
      href={`/vn/${vnId}/`}
      className="group block rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-500 bg-gray-50 dark:bg-gray-700/50 transition-shadow"
    >
      <div className="relative aspect-[3/4] bg-gray-200 dark:bg-gray-700">
        {showImage && !imageLoaded && (
          <div className="absolute inset-0 image-placeholder" />
        )}
        {showImage ? (
          <NSFWImage
            src={imageUrl}
            alt={displayTitle}
            vnId={vnId}
            imageSexual={imageSexual}
            className={`w-full h-full object-cover object-top transition-opacity duration-200 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading="lazy"
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-xs">
            No cover
          </div>
        )}
        <div
          className="absolute top-1.5 right-1.5 px-1.5 py-0.5 text-white text-[10px] font-medium rounded z-10"
          style={{ backgroundColor: badgeColor }}
        >
          {badgeLabel}
        </div>
      </div>
      <div className="p-1.5">
        <p className="text-[11px] font-medium text-gray-900 dark:text-white line-clamp-2 leading-tight group-hover:text-primary-600 dark:group-hover:text-primary-400">
          {displayTitle}
        </p>
      </div>
    </Link>
  );
}

// ──────────── 6. Similar Difficulty VNs ────────────

function SimilarDifficultySection({ vns, currentDifficulty }: { vns: SimilarDifficultyVN[]; currentDifficulty: number }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-5 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Similar Difficulty</h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          Other visual novels with a similar reading difficulty ({getDifficultyLabel(currentDifficulty)}, {currentDifficulty.toFixed(1)}/5)
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
        {vns.map(vn => (
          <SimilarVNCard
            key={vn.vnId}
            vnId={vn.vnId}
            title={vn.title}
            titleJp={vn.titleJp}
            coverUrl={vn.coverUrl}
            imageSexual={vn.imageSexual}
            badgeLabel={vn.difficulty.toFixed(1)}
            badgeColor={getDifficultyColor(vn.difficulty)}
          />
        ))}
      </div>
    </div>
  );
}

// ──────────── 7. Similar Length VNs ────────────

function SimilarLengthSection({ vns, currentCharCount }: { vns: SimilarLengthVN[]; currentCharCount: number }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-5 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Similar Length</h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          Other visual novels with a similar character count ({formatCount(currentCharCount)} chars)
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
        {vns.map(vn => (
          <SimilarVNCard
            key={vn.vnId}
            vnId={vn.vnId}
            title={vn.title}
            titleJp={vn.titleJp}
            coverUrl={vn.coverUrl}
            imageSexual={vn.imageSexual}
            badgeLabel={formatCount(vn.characterCount)}
            badgeColor={getLengthColor(vn.characterCount)}
          />
        ))}
      </div>
    </div>
  );
}

// ──────────── Skeleton ────────────

function LanguageStatsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Reading style hero */}
      <div className="h-28 rounded-xl bg-gray-100 dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700/80" />
      {/* Radar chart */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200/60 dark:border-gray-700/80">
        <div className="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700 mb-4" />
        <div className="h-64 rounded bg-gray-100 dark:bg-gray-700/40" />
      </div>
      {/* Heatmap */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200/60 dark:border-gray-700/80">
        <div className="h-4 w-36 rounded bg-gray-200 dark:bg-gray-700 mb-4" />
        <div className="h-10 rounded-lg bg-gray-100 dark:bg-gray-700/40" />
      </div>
      {/* Coverage curve */}
      <div className="h-64 rounded-xl bg-gray-100 dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700/80" />
    </div>
  );
}


