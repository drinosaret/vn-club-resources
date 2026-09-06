'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from '@/components/Link';
import { useRouter, useSearchParams } from 'next/navigation';
import { RotateCcw, X } from 'lucide-react';

import { BoardHeader } from '@/components/rankings/BoardHeader';
import { BoardHeaderSkeleton } from '@/components/rankings/BoardHeaderSkeleton';
import { LeaderboardTable } from '@/components/rankings/LeaderboardTable';
import { StatsCrossLinks } from '@/components/stats/StatsCrossLinks';
import { TagPicker } from '@/components/stats/TagPicker';
import type { PickedTag } from '@/components/stats/TagPicker';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { CustomQuestion, LeaderboardResult } from '@/lib/vndb-stats-api';

import {
  AGE_OPTIONS,
  ATTENTION_OPTIONS,
  ADULT_SCENE_TAG_CATEGORIES,
  DIFFICULTY_BANDS,
  FREE_OPTIONS,
  LANGUAGE_OPTIONS,
  EMPTY_SLICE,
  LENGTH_OPTIONS,
  PLATFORM_OPTIONS,
  PRESETS,
  activeAxes,
  fromSearchParams,
  judgedYears,
  releaseYears,
  toQuery,
  toSearchParams,
} from './slice-options';
import type { SliceState } from './slice-options';

/**
 * Any slice of the database, ranked by any question that can be asked of it.
 *
 * The curated boards each cost a share of the nightly job, so they are a fixed set chosen in
 * advance, and any of them narrowed by era or platform or length is a guess at which slice
 * somebody wanted. This asks the same questions of whatever slice a reader
 * builds, which is only possible because it is computed on request.
 *
 * The whole state lives in the URL. A ranking someone finds interesting is the kind of thing
 * they send to somebody else, and that has to survive being pasted.
 */

/**
 * The shared control styling.
 *
 * `text-base` below the small breakpoint is load-bearing rather than cosmetic: a form control
 * under 16px makes mobile Safari zoom the viewport on focus and leave it zoomed, and this pane
 * holds eight of them.
 */
const SELECT_CLASS = 'st-select w-full min-h-11 px-3 py-2 text-base sm:min-h-0 sm:text-sm';

const LABEL_CLASS = 'fig-label mb-1.5';

/** What an empty result means, in the terms that are true for this slice and question. */
function emptyMessage(slice: SliceState, titles: number | null): string {
  if (titles === 0) {
    return 'No titles match this slice, so there is nothing to rank. Try widening it.';
  }
  if (slice.difficulty !== 'any' || slice.question === 'hardest' || slice.question === 'easiest') {
    return 'No title here has had its Japanese measured yet, which covers a small part of the database.';
  }
  if (slice.subject === 'readers') {
    return 'Nobody has read enough of this slice to place.';
  }
  return 'Nothing in this slice has enough votes to be ranked.';
}

/** One sentence on the current state of the results, for a screen reader. */
function announcement(loading: boolean, result: LeaderboardResult | null): string {
  if (loading) return 'Working out the ranking.';
  if (!result) return 'No ranking yet.';
  if (result.state === 'invalid') return result.detail;
  if (result.state !== 'ok') return 'The ranking could not be loaded.';
  const { board } = result;
  if (!board.rows.length) return `${board.title}. Nothing qualifies.`;
  return `${board.title}. Showing ${board.rows.length} of ${board.total_ranked.toLocaleString()}.`;
}

export default function RankingBuilderClient() {
  const router = useRouter();
  const params = useSearchParams();
  // Read once, as the initial state. The URL is written from state after this, so treating
  // it as the source of truth on every render would make each control lag its own click.
  const [slice, setSlice] = useState<SliceState>(() =>
    fromSearchParams(new URLSearchParams(params.toString())),
  );
  const [questions, setQuestions] = useState<Record<string, CustomQuestion[]>>({});
  const [presetGroup, setPresetGroup] = useState(PRESETS[0].group);
  const [result, setResult] = useState<LeaderboardResult | null>(null);
  const [loading, setLoading] = useState(true);

  // The picker is built from the backend's own list, so a question added there appears here
  // without a second edit and one removed cannot linger in a dropdown that no longer works.
  useEffect(() => {
    vndbStatsApi.getCustomQuestions().then((next) => {
      if (next) setQuestions({ vns: next.vns, readers: next.readers });
    });
  }, []);

  const available = useMemo(
    () => questions[slice.subject] ?? [],
    [questions, slice.subject],
  );
  const question = available.find((entry) => entry.key === slice.question) ?? null;

  // A hand-edited or stale link can name a question that no longer exists. Falling back to
  // the subject's own first question answers something rather than reporting the service as
  // unreachable, which is what a rejected request would otherwise look like.
  useEffect(() => {
    if (!available.length || question) return;
    setSlice((current) => ({ ...current, question: available[0].key }));
  }, [available, question]);

  // The URL is written from state rather than read on every render. Reading it back as the
  // source of truth would make each control lag a click behind its own selection.
  useEffect(() => {
    const query = toSearchParams(slice);
    router.replace(query ? `/stats/rankings/build/?${query}` : '/stats/rankings/build/', {
      scroll: false,
    });
  }, [slice, router]);

  useEffect(() => {
    // A slice with no year cannot answer the as-of question, and asking anyway would trade a
    // ranking for a validation error while somebody is still choosing.
    if (slice.question === 'as-of' && !slice.asOf) {
      setLoading(false);
      return;
    }
    // Wait for the question list before asking, so an unrecognised one is corrected above
    // rather than sent and refused.
    if (available.length && !question) return;
    const controller = new AbortController();
    setLoading(true);
    vndbStatsApi.getCustomRanking(toQuery(slice), controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setResult(next);
      setLoading(false);
    });
    return () => controller.abort();
  }, [slice, available.length, question]);

  const update = useCallback((patch: Partial<SliceState>) => {
    setSlice((current) => {
      const next = { ...current, ...patch };
      // A range whose start is above its end is refused by the server, and a refusal reads on
      // screen as the service being down. Carrying the other end along keeps the pair valid
      // without taking the choice away.
      if (patch.yearMin && next.yearMax && patch.yearMin > next.yearMax) {
        next.yearMax = patch.yearMin;
      }
      if (patch.yearMax && next.yearMin && patch.yearMax < next.yearMin) {
        next.yearMin = patch.yearMax;
      }
      // Switching subject strands the question, since the two ask different things of the
      // same slice. Falling back to each side's first question keeps the page answering.
      if (patch.subject && patch.subject !== current.subject && !patch.question) {
        next.question = patch.subject === 'readers' ? 'read-most' : 'rated';
      }
      return next;
    });
  }, []);

  const applyPreset = useCallback((patch: Partial<SliceState>) => {
    // A preset is a whole state, not a set of additions: landing on one from a half-built
    // slice should show what its label says, not that crossed with whatever was there.
    setSlice({ ...EMPTY_SLICE, ...patch });
  }, []);

  const clearAxis = useCallback((key: keyof SliceState) => {
    if (key === 'yearMin') return update({ yearMin: null, yearMax: null });
    if (key === 'tag') return update({ tag: null, tagName: null });
    if (key === 'difficulty') return update({ difficulty: 'any' });
    if (key === 'olang') return update({ olang: 'ja' });
    if (key === 'free') return update({ free: 'any' });
    return update({ [key]: null } as Partial<SliceState>);
  }, [update]);

  const board = result?.state === 'ok' ? result.board : null;
  const titles = typeof board?.facet?.titles === 'number' ? board.facet.titles : null;
  const axes = activeAxes(slice);
  const pickedTag: PickedTag | null = slice.tag
    ? { id: slice.tag, name: slice.tagName ?? `Tag ${slice.tag}` }
    : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <Link
        href="/stats/rankings/"
        className="sec-more mb-6 min-h-6 py-1.5"
      >
        <span aria-hidden>&larr;</span>
        All rankings
      </Link>

      <h1 className="sec-title">Build a ranking</h1>
      <p className="sec-sub mb-6 max-w-2xl">
        Choose which titles you mean and what you want to know about them. Every combination
        is worked out when you ask for it, so there is no fixed list of slices, and the
        result is a link you can send to somebody.
      </p>

      {/* Grouped behind tabs rather than laid out as five rows of chips. The full set is
          thirty-odd starting points, and printed all at once they read as a wall with no
          structure; one group at a time is scannable and says what kind of thing is on offer. */}
      <section className="mb-6 st-card p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="fig-label">Start from</p>
          <div role="tablist" aria-label="Preset groups" className="tabs">
            {PRESETS.map((group) => (
              <button
                key={group.group}
                type="button"
                role="tab"
                aria-selected={presetGroup === group.group}
                onClick={() => setPresetGroup(group.group)}
                className={`tab min-h-8 ${presetGroup === group.group ? 'tab--on' : ''}`}
              >
                {group.group}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(PRESETS.find((group) => group.group === presetGroup) ?? PRESETS[0]).items.map(
            (preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset.slice)}
                className="st-act min-h-8"
              >
                {preset.label}
              </button>
            ),
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[21rem_1fr] lg:items-start">
        {/* The controls stay put while the ranking scrolls beside them: this page is used by
            changing one axis and reading the result, and a picker that scrolls away makes
            that a round trip to the top. */}
        {/* Scrolls within itself once the controls outrun the window, so the pane can stay
            pinned without the last axis becoming unreachable. */}
        <div className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
        <div className="mb-6 space-y-5 st-card p-4 sm:p-5 lg:mb-0">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <span className={LABEL_CLASS}>Rank</span>
              <div role="group" aria-label="What to rank" className="tabs">
                {(['vns', 'readers'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => update({ subject: option })}
                    aria-pressed={slice.subject === option}
                    className={`tab min-h-9 ${slice.subject === option ? 'tab--on' : ''}`}
                  >
                    {option === 'vns' ? 'Titles' : 'Readers'}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-w-[13rem] flex-1">
              <label className={LABEL_CLASS} htmlFor="ranking-question">
                By
              </label>
              <select
                id="ranking-question"
                className={SELECT_CLASS}
                value={slice.question}
                onChange={(event) => update({ question: event.target.value })}
              >
                {available.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>

            {question?.needs_year ? (
              <div className="min-w-[9rem]">
                <label className={LABEL_CLASS} htmlFor="ranking-asof">
                  Judged by the end of
                </label>
                <select
                  id="ranking-asof"
                  className={SELECT_CLASS}
                  value={slice.asOf ?? ''}
                  onChange={(event) =>
                    update({ asOf: event.target.value ? Number(event.target.value) : null })
                  }
                >
                  <option value="">Pick a year</option>
                  {judgedYears().map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          {question ? (
            // The short form only. The full explanation is on the ranking itself, and printing
            // it twice on one screen reads as a mistake rather than as emphasis.
            <p className="st-card-sub">Top of the ranking: {question.high_means}.</p>
          ) : null}

          <div className="border-t border-[color:var(--rule)] pt-4">
            <p className="fig-label mb-3">Narrow it to</p>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="sm:col-span-2 lg:col-span-1">
                <TagPicker
                  selected={pickedTag}
                  onSelect={(next) =>
                    update({ tag: next?.id ?? null, tagName: next?.name ?? null })
                  }
                  placeholder="Any tag"
                  excludeCategories={
                    slice.subject === 'readers' ? ADULT_SCENE_TAG_CATEGORIES : undefined
                  }
                />
              </div>

              <div>
                <label className={LABEL_CLASS} htmlFor="ranking-from">
                  Released from
                </label>
                <select
                  id="ranking-from"
                  className={SELECT_CLASS}
                  value={slice.yearMin ?? ''}
                  onChange={(event) =>
                    update({ yearMin: event.target.value ? Number(event.target.value) : null })
                  }
                >
                  <option value="">Any year</option>
                  {releaseYears().map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={LABEL_CLASS} htmlFor="ranking-to">
                  Released to
                </label>
                <select
                  id="ranking-to"
                  className={SELECT_CLASS}
                  value={slice.yearMax ?? ''}
                  onChange={(event) =>
                    update({ yearMax: event.target.value ? Number(event.target.value) : null })
                  }
                >
                  <option value="">Any year</option>
                  {releaseYears().map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={LABEL_CLASS} htmlFor="ranking-platform">
                  Platform
                </label>
                <select
                  id="ranking-platform"
                  className={SELECT_CLASS}
                  value={slice.platform ?? ''}
                  onChange={(event) => update({ platform: event.target.value || null })}
                >
                  <option value="">Any platform</option>
                  {PLATFORM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={LABEL_CLASS} htmlFor="ranking-length">
                  Length
                </label>
                <select
                  id="ranking-length"
                  className={SELECT_CLASS}
                  value={slice.length ?? ''}
                  onChange={(event) =>
                    update({ length: event.target.value ? Number(event.target.value) : null })
                  }
                >
                  <option value="">Any length</option>
                  {LENGTH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={LABEL_CLASS} htmlFor="ranking-age">
                  Age rating
                </label>
                <select
                  id="ranking-age"
                  className={SELECT_CLASS}
                  value={slice.minage ?? ''}
                  onChange={(event) =>
                    update({ minage: event.target.value === '' ? null : Number(event.target.value) })
                  }
                >
                  <option value="">Any rating</option>
                  {AGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={LABEL_CLASS} htmlFor="ranking-difficulty">
                  Japanese difficulty
                </label>
                <select
                  id="ranking-difficulty"
                  className={SELECT_CLASS}
                  value={slice.difficulty}
                  onChange={(event) =>
                    update({ difficulty: event.target.value as SliceState['difficulty'] })
                  }
                >
                  {Object.entries(DIFFICULTY_BANDS).map(([key, band]) => (
                    <option key={key} value={key}>
                      {band.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={LABEL_CLASS} htmlFor="ranking-language">
                  Original language
                </label>
                <select
                  id="ranking-language"
                  className={SELECT_CLASS}
                  value={slice.olang}
                  onChange={(event) =>
                    update({ olang: event.target.value as SliceState['olang'] })
                  }
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={LABEL_CLASS} htmlFor="ranking-free">
                  Price
                </label>
                <select
                  id="ranking-free"
                  className={SELECT_CLASS}
                  value={slice.free}
                  onChange={(event) =>
                    update({ free: event.target.value as SliceState['free'] })
                  }
                >
                  {FREE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={LABEL_CLASS} htmlFor="ranking-attention">
                  Attention
                </label>
                <select
                  id="ranking-attention"
                  className={SELECT_CLASS}
                  value={slice.votesMax ?? ''}
                  onChange={(event) =>
                    update({ votesMax: event.target.value ? Number(event.target.value) : null })
                  }
                >
                  {ATTENTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {slice.difficulty !== 'any' ||
            question?.needs_difficulty ? (
              <p className="st-card-sub mt-3">
                Difficulty comes from{' '}
                <a
                  href="https://jiten.moe/decks/media?mediaType=7"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-[color:var(--nezu)]"
                >
                  jiten.moe
                </a>
                , which has measured part of the database. Asking for it narrows the ranking to
                those titles, so this is a ranking of what has been measured rather than of
                everything.
              </p>
            ) : null}
          </div>

          {axes.length ? (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-[color:var(--rule)] pt-4">
              <span className="fig-label mr-1">Narrowed by</span>
              {axes.map((axis) => (
                <button
                  key={axis.key}
                  type="button"
                  onClick={() => clearAxis(axis.key)}
                  className="st-act min-h-8 max-w-full"
                >
                  {/* A tag name runs to any length the database holds, and the control it sits
                      in does not wrap, so the label is bounded and clipped instead. */}
                  <span className="min-w-0 truncate">{axis.label}</span>
                  <X className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">Remove</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSlice(EMPTY_SLICE)}
                className="st-act ml-auto min-h-8"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Reset
              </button>
            </div>
          ) : null}
        </div>
        </div>

        {/* The ranking itself. Its own pane, so a change on the left redraws only this side
            and the page does not jump back to the top to show it. */}
        <div className="min-w-0">
        <p className="sr-only" role="status">
          {announcement(loading, result)}
        </p>

        <div aria-busy={loading}>
        {slice.question === 'as-of' && !slice.asOf ? (
          <p className="st-card px-4 py-10 text-center text-sm text-[color:var(--nezu)]">
            Pick the year to judge by.
          </p>
        ) : loading ? (
          <>
            <BoardHeaderSkeleton />
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="image-placeholder h-14 rounded-xs" />
              ))}
            </div>
          </>
        ) : !board ? (
          // Three different absences with three different causes. Reporting them the same
          // way would make an outage read as routine.
          <p className="text-[color:var(--nezu)]">
            {result?.state === 'missing'
              ? 'No tag with that id exists. Try searching for it by name.'
              : result?.state === 'rebuilding'
                ? 'The rankings are being rebuilt from the latest VNDB data. Check back shortly.'
                : result?.state === 'invalid'
                  ? result.detail
                  : 'The rankings service could not be reached. This is usually brief.'}
          </p>
        ) : (
          <>
            {/* The page's own heading names the subject, so the ranking's title is a
                section within it rather than a second document heading. */}
            <BoardHeader board={board} headingLevel="h2" />
            <LeaderboardTable rows={board.rows} emptyMessage={emptyMessage(slice, titles)} />
          </>
        )}
        </div>
        </div>
      </div>

      <div className="mt-12">
        <StatsCrossLinks current="rankings" />
      </div>
    </div>
  );
}
