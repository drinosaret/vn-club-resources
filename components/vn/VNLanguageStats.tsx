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
import { ChartHelpTooltip } from '@/components/stats/ChartHelpTooltip';
import { difficultyColor, difficultyLabel } from '@/lib/difficulty';
// Shared with the server-rendered summary above the tabs, so one title cannot be described
// one way in the delivered markup and another way once the charts mount.
import { classifyReadingStyle, formatCount } from '@/lib/reading-style';
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
import Link from '@/components/Link';


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
  deckId?: number | null;
}

// ──────────── Helpers ────────────

// Difficulty banding lives in lib/difficulty.ts: the same title must not be labelled one
// way here and another way on the pages that also show it.
const getDifficultyColor = difficultyColor;
const getDifficultyLabel = (difficulty: number): string =>
  difficultyLabel(difficulty) ?? 'Unrated';

/* Recharts takes a colour string rather than a class, so the two the charts draw with are
   named here as the palette's own values. */
const CHART_INK = '#35808C';
const CHART_INK_LIGHT = '#8DBEC5';
const CHART_LIVE = '#E8A317';
const CHART_LIVE_LIGHT = '#F2D49B';

function getLengthColor(chars: number): string {
  if (chars <= 100_000) return '#22c55e';
  if (chars <= 300_000) return '#3b82f6';
  if (chars <= 600_000) return '#f59e0b';
  if (chars <= 1_000_000) return '#f97316';
  return '#ef4444';
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
          className="stroke-[color:var(--rule)]"
          strokeWidth={1}
        />
      ))}
      {/* Axis lines */}
      {data.map((_, i) => {
        const [x, y] = vertex(RADAR_CX, RADAR_CY, RADAR_R, i, n);
        return <line key={i} x1={RADAR_CX} y1={RADAR_CY} x2={x} y2={y} className="stroke-[color:var(--rule)]" strokeWidth={1} />;
      })}
      {/* Data polygon */}
      <polygon
        points={dataPoints}
        stroke={CHART_INK}
        fill={CHART_INK}
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
            className="fill-[color:var(--nezu)]"
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
  // Skip fetch entirely when we already know there's no jiten deck (deckId === null).
  // This avoids a skeleton flash before the "no data" message.
  const { data: allData, error: allError, isLoading: allLoading } = useJitenAll(deckId === null ? null : vnId);

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
      <div className="text-center py-12 text-[color:var(--nezu)]">
        Language analysis data could not be loaded.
      </div>
    );
  }

  // Detail still loading: show full skeleton
  if (allLoading) return <LanguageStatsSkeleton />;

  // Detail loaded but no deck data
  if (!deck) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <span className="nameplate--plain nameplate">Not measured</span>
        <p className="text-sm text-[color:var(--ink)] mt-4 mb-1">No language data yet</p>
        <p className="text-xs text-[color:var(--nezu)] mb-5 text-center max-w-xs">
          This visual novel hasn&apos;t been analyzed on jiten.moe yet.
        </p>
        <a
          href="https://jiten.moe/decks/media?mediaType=7"
          target="_blank"
          rel="noopener noreferrer"
          className="tab"
        >
          Browse jiten.moe
          <span aria-hidden>&#8599;</span>
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

        {/* Difficulty Progression: deferred to avoid Firefox text flicker */}
        {deferredReady && diff?.progression && diff.progression.length > 1 && (
          <DifficultyFlow segments={diff.progression} average={diff.difficulty} />
        )}

        {/* Coverage Curve: deferred */}
        {deferredReady && cov && cov.length > 2 && (
          <CoverageCurveChart data={cov} />
        )}

        {/* Similar Difficulty: deferred */}
        {deferredReady && similar.length > 0 && (
          <SimilarDifficultySection vns={similar} currentDifficulty={deck.difficultyRaw} />
        )}

        {/* Similar Length: deferred */}
        {deferredReady && similarLength.length > 0 && (
          <SimilarLengthSection vns={similarLength} currentCharCount={deck.characterCount} />
        )}

        {/* Attribution */}
        <div className="vn-sec flex items-center justify-center gap-2 px-4 py-3">
          <span className="text-xs text-[color:var(--nezu)]">Language data provided by</span>
          <a
            href={attributionHref}
            target="_blank"
            rel="noopener noreferrer"
            className="sec-more"
          >
            jiten.moe
            <span aria-hidden>&#8599;</span>
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
    <section className="vn-sec">
      {/* Reading style header */}
      <div className="px-4 sm:px-5 py-4 border-b border-[color:var(--rule)]">
        <div className="flex items-center gap-2.5 mb-1">
          <h2 className="vn-sec-title">
            {style.label}
          </h2>
          <ChartHelpTooltip text={`Classification criteria: ${style.criteria}`} />
        </div>
        <p className="text-sm text-[color:var(--nezu)]">
          {style.description}
        </p>
      </div>

      <div className="p-4 sm:p-5">
        {/* Radar chart: lightweight custom SVG (replaces Recharts RadarChart) */}
        <SimpleRadar data={radarData} />

        {/* Raw values: labels match radar axes */}
        <div className={`grid ${(deck.hideDialoguePercentage || deck.dialoguePercentage === 0) ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3 sm:grid-cols-5'} gap-2 mt-4 pt-4 border-t border-[color:var(--rule)]`}>
          {[
            { label: 'Difficulty', value: `${deck.difficultyRaw.toFixed(1)}/5` },
            { label: 'Unique Words', value: formatCount(deck.uniqueWordCount) },
            ...(!deck.hideDialoguePercentage && deck.dialoguePercentage > 0 ? [{ label: 'Dialogue', value: `${Math.round(deck.dialoguePercentage)}%` }] : []),
            { label: 'Sentence Length', value: `${deck.averageSentenceLength.toFixed(1)} w/s` },
            { label: 'Volume', value: `${formatCount(deck.characterCount)} chars` },
          ].map(stat => (
            <div key={stat.label} className="text-center">
              <p className="fig-label mb-0.5">{stat.label}</p>
              <p className="vn-num text-sm text-[color:var(--ink)]">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ──────────── 3. Difficulty Progression Chart ────────────

function DifficultyTooltip(props: TooltipProps<number, string>) {
  const { active, payload, label } = props as { active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string };
  if (!active || !payload?.length) return null;
  const avg = payload.find(p => p.dataKey === 'difficulty')?.value;
  const peak = payload.find(p => p.dataKey === 'peak')?.value;
  return (
    <div className="vn-sec px-3 py-2">
      <p className="vn-num text-xs text-[color:var(--ink)] mb-0.5">
        Progress: {label}
      </p>
      {avg != null && (
        <p className="vn-num text-xs text-[color:var(--nezu)]">
          Avg: <span className="font-medium" style={{ color: getDifficultyColor(avg) }}>{avg.toFixed(2)}</span>
          {' · '}
          {getDifficultyLabel(avg)}
        </p>
      )}
      {peak != null && (
        <p className="vn-num text-xs text-[color:var(--nezu)]">
          Peak: <span className="font-medium" style={{ color: getDifficultyColor(peak) }}>{peak.toFixed(2)}</span>
        </p>
      )}
    </div>
  );
}

function DifficultyFlow({ segments, average }: { segments: Array<{ segment: number; difficulty: number; peak: number }>; average: number }) {
  const chartData = useMemo(() =>
    segments.map(seg => ({
      label: `${Math.round(((seg.segment) / segments.length) * 100)}%`,
      difficulty: Number(seg.difficulty.toFixed(2)),
      peak: Number(seg.peak.toFixed(2)),
    })),
    [segments]
  );

  return (
    <section className="vn-sec p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="vn-sec-title">Difficulty Progression</h2>
        <p className="text-xs text-[color:var(--nezu)] mt-0.5">
          Average and peak difficulty across sections of the game
        </p>
      </div>

      <ResponsiveContainer width="100%" height={200} className="[&_svg]:outline-hidden [&_svg_*]:outline-hidden [&_svg]:[-webkit-tap-highlight-color:transparent]">
        <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="peakRangeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_LIVE} stopOpacity={0.2} />
              <stop offset="95%" stopColor={CHART_LIVE} stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="avgDiffGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_INK} stopOpacity={0.25} />
              <stop offset="95%" stopColor={CHART_INK} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-[color:var(--rule)]" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            className="fill-[color:var(--nezu)]"
            axisLine={{ className: 'stroke-[color:var(--rule)]' }}
            tickLine={{ className: 'stroke-[color:var(--rule)]' }}
          />
          <YAxis
            domain={[0, 5]}
            ticks={[1, 2, 3, 4, 5]}
            tick={{ fontSize: 10 }}
            className="fill-[color:var(--nezu)]"
            axisLine={{ className: 'stroke-[color:var(--rule)]' }}
            tickLine={{ className: 'stroke-[color:var(--rule)]' }}
            width={30}
          />
          <Tooltip content={<DifficultyTooltip />} />
          <ReferenceLine
            y={average}
            stroke={CHART_INK}
            strokeDasharray="6 3"
            strokeOpacity={0.5}
            label={{
              value: `Avg ${average.toFixed(1)}`,
              position: 'insideTopRight',
              fontSize: 9,
              className: 'fill-[color:var(--nezu)]',
            }}
          />
          {/* Peak range band */}
          <Area
            type="monotone"
            dataKey="peak"
            stroke={CHART_LIVE}
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
            stroke={CHART_INK}
            strokeWidth={2}
            fill="url(#avgDiffGrad)"
            dot={{ r: 3, fill: CHART_INK, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: CHART_INK, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="fig-chart-legend justify-center mt-2">
        <span className="fig-key fig-key--readers">Average</span>
        <span className="fig-key fig-key--votes">Peak</span>
      </div>

    </section>
  );
}

// ──────────── 4. Coverage Curve with Reference Lines ────────────

const WORD_MILESTONES = [1000, 3000, 5000, 10000];

function CoverageTooltip(props: TooltipProps<number, string>) {
  const { active, payload } = props as { active?: boolean; payload?: Array<{ payload: JitenCoveragePoint }> };
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="vn-sec px-3 py-2">
      <p className="vn-num text-sm text-[color:var(--ink)]">
        {point.coverage}% coverage
      </p>
      <p className="vn-num text-xs text-[color:var(--nezu)]">
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
    <section className="vn-sec p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="vn-sec-title">Coverage Curve</h2>
        <p className="text-xs text-[color:var(--nezu)] mt-0.5">
          How much of the text you&apos;ll understand based on vocabulary size
        </p>
      </div>
      <ResponsiveContainer width="100%" height={240} className="[&_svg]:outline-hidden [&_svg_*]:outline-hidden [&_svg]:[-webkit-tap-highlight-color:transparent]">
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="coverageGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_INK} stopOpacity={0.3} />
              <stop offset="95%" stopColor={CHART_INK} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-[color:var(--rule)]" />
          <XAxis
            dataKey="rank"
            type="number"
            scale="log"
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 11 }}
            className="fill-[color:var(--nezu)]"
            axisLine={{ className: 'stroke-[color:var(--rule)]' }}
            tickLine={{ className: 'stroke-[color:var(--rule)]' }}
            tickFormatter={(v) => formatCount(v)}
            ticks={[1, 10, 100, 1000, 10000]}
            label={{ value: 'Words known', position: 'insideBottom', offset: -2, fontSize: 10, className: 'fill-[color:var(--nezu)]' }}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            className="fill-[color:var(--nezu)]"
            axisLine={{ className: 'stroke-[color:var(--rule)]' }}
            tickLine={{ className: 'stroke-[color:var(--rule)]' }}
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
              stroke={CHART_INK_LIGHT}
              strokeDasharray="4 3"
              strokeOpacity={0.6}
              label={{
                value: `${formatCount(m.words)} → ${m.coverage}%`,
                position: 'insideTopRight',
                fontSize: 9,
                dy: i * 14,
                className: 'fill-[color:var(--nezu)]',
              }}
            />
          ))}
          <Area
            type="monotone"
            dataKey="coverage"
            stroke={CHART_INK}
            strokeWidth={2}
            fill="url(#coverageGrad)"
            dot={false}
            activeDot={{ r: 4, fill: CHART_INK }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </section>
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
    <section className="vn-sec p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="vn-sec-title">Vocabulary Depth</h2>
        <p className="text-xs text-[color:var(--nezu)] mt-0.5">
          How vocabulary and kanji are distributed across the text
        </p>
      </div>

      <div className="space-y-4">
        {/* Words bar */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="fig-label">Words</span>
            <span className="vn-num text-[10px] text-[color:var(--text-faint)]">
              {formatCount(deck.uniqueWordCount)} distinct
            </span>
          </div>
          <div className="flex rounded-xs overflow-hidden h-6 border border-[color:var(--rule)]">
            <div
              className="vn-num flex items-center justify-center text-[10px] overflow-hidden truncate px-1"
              style={{ width: `${coreWordsPct}%`, backgroundColor: CHART_INK, color: '#FFFFFF' }}
            >
              {coreWordsPct > 20 && `${formatCount(coreWords)} recurring`}
            </div>
            <div
              className="vn-num flex items-center justify-center text-[10px] overflow-hidden truncate px-1"
              style={{ width: `${rareWordsPct}%`, backgroundColor: CHART_INK_LIGHT, color: '#17181A' }}
            >
              {rareWordsPct > 20 && `${formatCount(deck.uniqueWordUsedOnceCount)} one-off`}
            </div>
          </div>
          <div className="vn-num flex items-center justify-between mt-1 text-[10px] text-[color:var(--text-faint)]">
            <span>Recurring<span className="hidden sm:inline"> (2+ times)</span> · {coreWordsPct}%</span>
            <span>One-off<span className="hidden sm:inline"> (once)</span> · {rareWordsPct}%</span>
          </div>
        </div>

        {/* Kanji bar */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="fig-label">Kanji</span>
            <span className="vn-num text-[10px] text-[color:var(--text-faint)]">
              {formatCount(deck.uniqueKanjiCount)} distinct
            </span>
          </div>
          <div className="flex rounded-xs overflow-hidden h-6 border border-[color:var(--rule)]">
            <div
              className="vn-num flex items-center justify-center text-[10px] overflow-hidden truncate px-1"
              style={{ width: `${coreKanjiPct}%`, backgroundColor: CHART_LIVE, color: '#17181A' }}
            >
              {coreKanjiPct > 20 && `${formatCount(coreKanji)} recurring`}
            </div>
            <div
              className="vn-num flex items-center justify-center text-[10px] overflow-hidden truncate px-1"
              style={{ width: `${rareKanjiPct}%`, backgroundColor: CHART_LIVE_LIGHT, color: '#17181A' }}
            >
              {rareKanjiPct > 20 && `${formatCount(deck.uniqueKanjiUsedOnceCount)} one-off`}
            </div>
          </div>
          <div className="vn-num flex items-center justify-between mt-1 text-[10px] text-[color:var(--text-faint)]">
            <span>Recurring<span className="hidden sm:inline"> (2+ times)</span> · {coreKanjiPct}%</span>
            <span>One-off<span className="hidden sm:inline"> (once)</span> · {rareKanjiPct}%</span>
          </div>
        </div>

        {/* Repetition stat */}
        <div className="flex items-center justify-center gap-6 pt-3 border-t border-[color:var(--rule)]">
          <div className="text-center">
            <p className="fig-label mb-0.5">Total Words</p>
            <p className="vn-num text-sm text-[color:var(--ink)]">{formatCount(deck.wordCount)}</p>
          </div>
          <div className="text-center">
            <p className="fig-label mb-0.5">Sentences</p>
            <p className="vn-num text-sm text-[color:var(--ink)]">{formatCount(deck.sentenceCount)}</p>
          </div>
        </div>
      </div>
    </section>
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
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
      className="shelf-item block"
    >
      <div className="shelf-art">
        {showImage && !imageLoaded && (
          <div className="absolute inset-0 image-placeholder" />
        )}
        {showImage ? (
          <NSFWImage
            src={imageUrl}
            alt={displayTitle}
            vnId={vnId}
            imageSexual={imageSexual}
            className={`w-full h-full object-cover object-top ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading="lazy"
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-faint)]">
            No cover
          </div>
        )}
        {/* The measured band keeps its own colour: it is the one thing on the card that reports
            a scale rather than a state. */}
        <div
          className="vn-mark top-1.5 right-1.5"
          style={{ backgroundColor: badgeColor, color: '#17181A' }}
        >
          {badgeLabel}
        </div>
      </div>
      <div className="shelf-name">
        {displayTitle}
      </div>
    </Link>
  );
}

// ──────────── 6. Similar Difficulty VNs ────────────

function SimilarDifficultySection({ vns, currentDifficulty }: { vns: SimilarDifficultyVN[]; currentDifficulty: number }) {
  return (
    <section className="vn-sec p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="vn-sec-title">Similar Difficulty</h2>
        <p className="text-xs text-[color:var(--nezu)] mt-0.5">
          Other visual novels with a similar reading difficulty ({getDifficultyLabel(currentDifficulty)}, {currentDifficulty.toFixed(1)}/5)
        </p>
      </div>
      <div className="vn-shelf">
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
    </section>
  );
}

// ──────────── 7. Similar Length VNs ────────────

function SimilarLengthSection({ vns, currentCharCount }: { vns: SimilarLengthVN[]; currentCharCount: number }) {
  return (
    <section className="vn-sec p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="vn-sec-title">Similar Length</h2>
        <p className="text-xs text-[color:var(--nezu)] mt-0.5">
          Other visual novels with a similar character count ({formatCount(currentCharCount)} chars)
        </p>
      </div>
      <div className="vn-shelf">
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
    </section>
  );
}

// ──────────── Skeleton ────────────

function LanguageStatsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Reading style hero */}
      <div className="vn-sec h-28" />
      {/* Radar chart */}
      <div className="vn-sec p-5">
        <div className="h-4 w-24 rounded-xs bg-[color:var(--surface-inset)] mb-4" />
        <div className="h-64 rounded-xs bg-[color:var(--surface-inset)]" />
      </div>
      {/* Heatmap */}
      <div className="vn-sec p-5">
        <div className="h-4 w-36 rounded-xs bg-[color:var(--surface-inset)] mb-4" />
        <div className="h-10 rounded-xs bg-[color:var(--surface-inset)]" />
      </div>
      {/* Coverage curve */}
      <div className="vn-sec h-64" />
    </div>
  );
}


