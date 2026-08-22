'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from '@/components/Link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, RotateCcw, SlidersHorizontal, X } from 'lucide-react';

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
const SELECT_CLASS =
  'w-full min-h-11 rounded-lg border border-gray-200 bg-white px-3 py-2 text-base ' +
  'text-gray-800 transition-colors hover:border-gray-300 sm:min-h-0 sm:text-sm ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ' +
  'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-500 ' +
  'dark:focus-visible:outline-primary-400';

const LABEL_CLASS =
  'mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400';

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
        className="mb-6 -my-1.5 inline-flex min-h-6 items-center gap-1.5 py-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        All rankings
      </Link>

      <div className="mb-3 flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
          <SlidersHorizontal className="h-5 w-5 text-primary-600 dark:text-primary-400" />
        </span>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Build a ranking</h1>
      </div>
      <p className="mb-6 max-w-2xl text-gray-600 dark:text-gray-400">
        Choose which titles you mean and what you want to know about them. Every combination
        is worked out when you ask for it, so there is no fixed list of slices, and the
        result is a link you can send to somebody.
      </p>

      {/* Grouped behind tabs rather than laid out as five rows of chips. The full set is
          thirty-odd starting points, and printed all at once they read as a wall with no
          structure; one group at a time is scannable and says what kind of thing is on offer. */}
      <section className="mb-6 rounded-xl border border-gray-200/60 bg-white p-4 shadow-sm dark:border-gray-700/80 dark:bg-gray-800">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Start from
          </p>
          <div
            role="tablist"
            aria-label="Preset groups"
            className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900/40"
          >
            {PRESETS.map((group) => (
              <button
                key={group.group}
                type="button"
                role="tab"
                aria-selected={presetGroup === group.group}
                onClick={() => setPresetGroup(group.group)}
                className={`min-h-8 rounded-md px-3 text-xs font-medium transition-colors ${
                  presetGroup === group.group
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                }`}
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
                className="inline-flex min-h-8 items-center rounded-full border border-gray-200 px-3 text-xs text-gray-700 transition-colors hover:border-primary-400 hover:bg-primary-50 hover:text-primary-700 dark:border-gray-600 dark:text-gray-300 dark:hover:border-primary-500 dark:hover:bg-primary-900/20 dark:hover:text-primary-300"
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
        <div className="mb-6 space-y-5 rounded-xl border border-gray-200/60 bg-white p-4 shadow-sm dark:border-gray-700/80 dark:bg-gray-800 sm:p-5 lg:mb-0">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <span className={LABEL_CLASS}>Rank</span>
              <div
                role="group"
                aria-label="What to rank"
                className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-600"
              >
                {(['vns', 'readers'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => update({ subject: option })}
                    aria-pressed={slice.subject === option}
                    className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors ${
                      slice.subject === option
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                    }`}
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
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Top of the ranking: {question.high_means}.
            </p>
          ) : null}

          <div className="border-t border-gray-200/70 pt-4 dark:border-gray-700/70">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Narrow it to
            </p>

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
              <p className="mt-3 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
                Difficulty comes from{' '}
                <a
                  href="https://jiten.moe/decks/media?mediaType=7"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-gray-600 dark:hover:text-gray-300"
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
            <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-200/70 pt-4 dark:border-gray-700/70">
              <span className="mr-1 text-xs text-gray-500 dark:text-gray-400">Narrowed by</span>
              {axes.map((axis) => (
                <button
                  key={axis.key}
                  type="button"
                  onClick={() => clearAxis(axis.key)}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full border border-gray-200 px-2.5 text-xs text-gray-700 transition-colors hover:border-red-300 hover:text-red-600 dark:border-gray-600 dark:text-gray-300 dark:hover:border-red-700 dark:hover:text-red-400"
                >
                  {axis.label}
                  <X className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">Remove</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSlice(EMPTY_SLICE)}
                className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-xs text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
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
          <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Pick the year to judge by.
          </p>
        ) : loading ? (
          <>
            <BoardHeaderSkeleton />
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="image-placeholder h-14 rounded-lg" />
              ))}
            </div>
          </>
        ) : !board ? (
          // Three different absences with three different causes. Reporting them the same
          // way would make an outage read as routine.
          <p className="text-gray-600 dark:text-gray-400">
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
