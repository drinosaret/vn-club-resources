'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Check, X } from 'lucide-react';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { getEntityDisplayName, useDisplayTitle, useTitlePreference } from '@/lib/title-preference';
import { useImageFade } from '@/hooks/useImageFade';
import { NSFWImage } from '@/components/NSFWImage';
import type { HigherLowerPoolVN } from '@/lib/vndb-stats-api';
import { MetricCountUp } from './MetricCountUp';
import { METRICS, type MetricKey } from './metrics';

// static  -> anchor: its metric value is shown.
// guess   -> challenger waiting for input: Higher / Lower buttons.
// countup -> challenger revealing: animate (votes) or show (rating, year) the value.
// revealed-> challenger settled: value + correct/wrong styling.
type Phase = 'static' | 'guess' | 'countup' | 'revealed';

interface VNPanelProps {
  vn: HigherLowerPoolVN;
  metric: MetricKey;
  phase: Phase;
  verdict?: 'correct' | 'wrong' | null;
  // The anchor (and the revealed challenger at game over) link to the VN page; the
  // challenger being guessed must not, or its details would spoil the round.
  linkable?: boolean;
  onGuess?: (dir: 'higher' | 'lower') => void;
}

export function VNPanel({ vn, metric, phase, verdict = null, linkable = false, onGuess }: VNPanelProps) {
  const getTitle = useDisplayTitle();
  const [imgFailed, setImgFailed] = useState(false);
  const title = getTitle({ title: vn.title, title_jp: vn.title_jp ?? undefined, title_romaji: vn.title_romaji ?? undefined });
  const src = getProxiedImageUrl(vn.image_url, { width: 512, vnId: vn.id });
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  // The panel is reused across VN changes (so the cover swaps smoothly instead of
  // remounting to a blank), but clear a stale error so a broken cover does not blank
  // the next one.
  useEffect(() => setImgFailed(false), [vn.id]);
  const m = METRICS[metric];
  // Subtitle: developer and release year joined by a divider. In year mode the year is
  // the value being guessed, so it is dropped (developer only). The developer name
  // follows the same JP/romaji preference as titles.
  const { preference } = useTitlePreference();
  const developer = vn.developer
    ? getEntityDisplayName({ name: vn.developer, original: vn.developer_original }, preference)
    : null;
  const subtitle = [developer, metric !== 'year' && vn.year != null ? String(vn.year) : null]
    .filter(Boolean)
    .join(' · ');

  // Cover + title. When linkable, this becomes a link to the VN; a blurred NSFW cover
  // still intercepts the first click to reveal (NSFWImage), matching VNCard.
  const head = (
    <>
      <div className="relative aspect-3/4 max-h-40 w-full bg-gray-100 dark:bg-gray-900 sm:max-h-56">
        {src && !imgFailed ? (
          <>
            <div className={shimmerClass} />
            <NSFWImage
              src={src}
              alt={title}
              vnId={vn.id}
              imageSexual={vn.image_sexual ?? undefined}
              objectPosition="top"
              className={`h-full w-full object-cover transition group-hover/card:brightness-95 ${fadeClass}`}
              loading="eager"
              onLoad={onLoad}
              onError={() => setImgFailed(true)}
            />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-300 dark:text-gray-600">
            <BookOpen className="h-10 w-10" />
          </div>
        )}
      </div>
      {/* Title/developer/tags reserve fixed heights (inline so they apply even before the
          dev server regenerates utility classes) so the panel does not jump as the pair
          changes. The title is bottom-aligned in its 2-line box so 1- and 2-line titles
          share a baseline: the developer and tags stay evenly spaced beneath it and the
          slack from a short title falls above it instead of wedging between title and dev. */}
      <div className="px-3 pt-4 text-center">
        <div className="flex items-end" style={{ height: '2.25rem' }}>
          <h3 className="w-full line-clamp-2 text-sm font-semibold leading-tight text-gray-900 transition-colors group-hover/card:text-violet-600 dark:text-white dark:group-hover/card:text-violet-400">
            {title}
          </h3>
        </div>
        {/* Developer + year wrap to two lines instead of truncating: they are a real
            guessing signal, so the full studio name and year stay readable on a narrow card. */}
        <p className="mt-2 line-clamp-2 text-xs text-gray-400 dark:text-gray-500" style={{ minHeight: '1rem' }}>
          {subtitle}
        </p>
        {/* Top spoiler-free tags: a genre preview and a soft signal. A long tag wraps to a
            second line within its pill (max-w-full bounds the pill, the text wraps) rather
            than truncating, since the tag set is worth reading in full. .hl-tag-box reserves
            the common height (three rows on mobile, two on desktop) so the panel stays put
            for typical pairs and only a tag-heavy card grows past it. */}
        <div className="hl-tag-box mt-3 flex flex-wrap content-start justify-center gap-1">
          {(vn.tags ?? []).map((t) => (
            <span
              key={t}
              title={t}
              className="line-clamp-2 max-w-full rounded bg-gray-100 px-1.5 py-0.5 text-[10px] leading-tight text-gray-500 dark:bg-gray-700/60 dark:text-gray-400"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {/* The same <a> always renders (so toggling linkable never remounts the cover); it
          only becomes a real link when linkable. With no href until then, the challenger
          can never be opened mid-round (not even via middle click), so it can't spoil the
          round. Links open in a new tab so a click never ends your streak. */}
      <a
        href={linkable ? `/vn/${vn.id}/` : undefined}
        target={linkable ? '_blank' : undefined}
        rel={linkable ? 'noopener noreferrer' : undefined}
        aria-label={linkable ? `View ${title} in a new tab` : undefined}
        className={linkable ? 'group/card block' : 'block cursor-default'}
      >
        {head}
      </a>

      {/* min-height matches the guess block (caption + two buttons + padding = 132px), so
          swapping buttons for the value at the reveal never changes the card height. Inline
          because the dev server does not regenerate new arbitrary utility classes. */}
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 px-3 pb-4 pt-2"
        style={{ minHeight: '8.25rem' }}
      >
        {phase === 'static' && <MetricValue vn={vn} metric={metric} />}
        {phase === 'revealed' && <MetricValue vn={vn} metric={metric} verdict={verdict} />}
        {phase === 'countup' && <MetricValue vn={vn} metric={metric} animate />}
        {phase === 'guess' && (
          <div className="flex w-full max-w-[12rem] flex-col gap-2">
            <p className="text-center text-xs text-gray-400 dark:text-gray-500">{m.caption}</p>
            <GuessButton dir="higher" onGuess={onGuess} />
            <GuessButton dir="lower" onGuess={onGuess} />
          </div>
        )}
      </div>
    </div>
  );
}

function MetricValue({
  vn,
  metric,
  animate = false,
  verdict = null,
}: {
  vn: HigherLowerPoolVN;
  metric: MetricKey;
  animate?: boolean;
  verdict?: 'correct' | 'wrong' | null;
}) {
  const m = METRICS[metric];
  const v = m.value(vn);
  const color =
    verdict === 'correct'
      ? 'text-emerald-600 dark:text-emerald-400'
      : verdict === 'wrong'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-gray-900 dark:text-white';
  // The value is the payoff of the round, so it gets scoreboard weight: large enough to
  // own the reserved bottom area instead of floating small inside it. Mobile stays at
  // 2xl so a five-digit vote count fits the narrow panel.
  return (
    <p className={`flex items-baseline gap-2 text-2xl font-bold tabular-nums sm:text-4xl ${color}`}>
      {/* The verdict icon floats above the number (absolute, out of the flex flow) so its
          arrival never pushes the number sideways at the moment the player is reading it.
          Above rather than beside: the reserved bottom area always has headroom there,
          while a side icon can clip on a narrow panel with a five-digit count. Anchored to
          the number span, not the row, so it centers over the digits rather than drifting
          toward the unit label. */}
      <span className="relative">
        {verdict && (
          <span
            className="animate-slide-down absolute left-1/2 -translate-x-1/2"
            style={{ bottom: '100%', marginBottom: '0.125rem' }}
          >
            {verdict === 'correct' ? <Check className="h-6 w-6" /> : <X className="h-6 w-6" />}
          </span>
        )}
        {animate && m.animate ? <MetricCountUp value={v} /> : m.format(v)}
      </span>
      {m.unit ? <span className="text-xs font-normal text-gray-400 sm:text-sm">{m.unit}</span> : null}
    </p>
  );
}

function GuessButton({ dir, onGuess }: { dir: 'higher' | 'lower'; onGuess?: (dir: 'higher' | 'lower') => void }) {
  const Icon = dir === 'higher' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onGuess?.(dir)}
      className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 py-2 text-sm font-semibold text-gray-700 transition hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-200 dark:hover:border-violet-500 dark:hover:bg-violet-500/10 dark:hover:text-violet-300"
    >
      <Icon className="h-4 w-4" /> {dir === 'higher' ? 'Higher' : 'Lower'}
    </button>
  );
}
