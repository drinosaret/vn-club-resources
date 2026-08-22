'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Flame, Search, SlidersHorizontal, Trophy, X } from 'lucide-react';

import { EMPTY_SLICE, PRESETS, toSearchParams } from './build/slice-options';
import { DataFreshness } from '@/components/stats/DataFreshness';
import { describeField } from '@/components/rankings/subject-labels';
import { StatsCrossLinks } from '@/components/stats/StatsCrossLinks';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { LeaderboardCatalogue, LeaderboardCatalogueEntry } from '@/lib/vndb-stats-api';
import { CATALOGUE_SECTIONS, INTENTS, clusterBoards } from './catalogue-structure';
import { SectionRail, SectionStrip } from './SectionNav';

/** Free-text match over what a card actually shows. Module scope so it is not a new value
 *  on every render, which is what stops the compiler optimising the component. */
function matchesQuery(board: LeaderboardCatalogueEntry, needle: string): boolean {
  if (!needle) return true;
  return (
    board.title.toLowerCase().includes(needle) ||
    board.blurb.toLowerCase().includes(needle)
  );
}

function BoardCard({ board }: { board: LeaderboardCatalogueEntry }) {
  // Boards catalogued on the trends page are still listed here, since this is where someone
  // looks for a board by name. The badge says where it is presented with its movement, and
  // links there rather than to the bare board.
  const onTrends = board.home === 'trends';

  return (
    <div className="group relative flex flex-col p-3.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700/80 hover:border-primary-400 dark:hover:border-primary-600 shadow-sm shadow-gray-200/50 dark:shadow-none transition-colors">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-sm text-gray-900 dark:text-white group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors">
          <Link href={`/stats/rankings/${board.slug}/`} className="after:absolute after:inset-0">
            {board.title}
          </Link>
        </h4>
        {onTrends ? (
          <Link
            href="/stats/trends/"
            // Lifted above the title's overlay so this reaches the trends page rather than
            // the board, which is the whole point of showing it.
            className="relative z-10 shrink-0 -my-1.5 -mr-1 inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-semibold text-orange-700 hover:bg-orange-200 dark:text-orange-300 dark:hover:bg-orange-900/70 transition-colors"
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-1.5 py-0.5 dark:bg-orange-900/40">
              <Flame className="w-2.5 h-2.5" />
              Trends
            </span>
          </Link>
        ) : board.window !== 'all' ? (
          <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
            {board.window === 'week' ? 'this week' : board.window === 'month' ? 'this month' : board.window}
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-400 line-clamp-2">
        {board.blurb}
      </p>

      {board.total_ranked > 0 ? (
        <p className="mt-auto pt-2 text-[11px] text-gray-400 dark:text-gray-500">
          {describeField(board.subject, board.total_ranked)}
        </p>
      ) : null}
    </div>
  );
}

export default function RankingsCatalogueClient({
  initialCatalogue,
}: {
  /**
   * The catalogue as the server already fetched it.
   *
   * Present, every board link is in the markup a crawler receives and the first paint is the
   * finished list. Null when the backend could not be reached, which leaves the fetch below.
   */
  initialCatalogue: LeaderboardCatalogue | null;
}) {
  const [catalogue, setCatalogue] = useState<LeaderboardCatalogue | null>(initialCatalogue);
  const [loading, setLoading] = useState(!initialCatalogue);
  const [query, setQuery] = useState('');
  const [activeIntent, setActiveIntent] = useState('all');
  const searchRef = useRef<HTMLInputElement>(null);

  // Typing beats scrolling on a page this long, so the search takes the usual shortcut.
  // Ignored while a field already has focus, where the key is just a character.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (initialCatalogue) return;
    vndbStatsApi
      .getLeaderboardCatalogue()
      .then(setCatalogue)
      .finally(() => setLoading(false));
  }, [initialCatalogue]);

  const boards = useMemo(() => catalogue?.boards ?? [], [catalogue]);

  const needle = useMemo(() => query.trim().toLowerCase(), [query]);

  const filtered = useMemo(() => {
    const intent = INTENTS.find((i) => i.key === activeIntent) ?? INTENTS[0];
    return boards.filter((board) => intent.matches(board) && matchesQuery(board, needle));
  }, [boards, activeIntent, needle]);

  // Counts on the chips, so a filter that would empty the page says so before it is used.
  const intentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const intent of INTENTS) {
      counts[intent.key] = boards.filter(
        (board) => intent.matches(board) && matchesQuery(board, needle),
      ).length;
    }
    return counts;
  }, [boards, needle]);

  const sections = useMemo(
    () =>
      CATALOGUE_SECTIONS.map((section) => ({
        section,
        boards: filtered.filter((board) => section.subjects.includes(board.subject)),
      })).filter((entry) => entry.boards.length > 0),
    [filtered],
  );

  const sectionCounts = useMemo(
    () => sections.map(({ section, boards: found }) => ({ section, count: found.length })),
    [sections],
  );

  const isFiltering = query.trim().length > 0 || activeIntent !== 'all';

  // Counts and the disabled state are only facts once the boards are in hand. Before that
  // every count is 0, which would grey out five of the six filters a moment before they work.
  const counted = !loading && !!catalogue;

  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900/30">
            <Trophy className="w-6 h-6 text-primary-600 dark:text-primary-400" />
          </span>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">Rankings</h1>
        </div>

        <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl">
          Leaderboards drawn from the whole vote record. Build one over any slice you like,
          or take one of the standing boards below, which answer the questions a slice on its
          own cannot. For what is popular right now, see trends.
        </p>

        <DataFreshness dumpDate={catalogue?.dump_date} className="mt-3" />
      </header>

      {/* The builder leads, because most board questions here are one slice of what it can ask.
          Presets are chips rather than links to pages: landing on one with the controls
          already filled in says the slice can be changed, which a fixed URL does not. */}
      <section className="mb-6 rounded-2xl border border-primary-200/70 bg-linear-to-br from-primary-50/80 to-white p-5 dark:border-primary-800/60 dark:from-primary-900/20 dark:to-gray-900/0 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-xl">
            <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white">
              <SlidersHorizontal className="h-5 w-5 text-primary-600 dark:text-primary-400" />
              Build a ranking
            </h2>
            <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">
              Pick an era, platform, length, tag, age rating or Japanese difficulty, then rank
              the titles in it or the readers who read them. Worked out when you ask, so there
              is no fixed list of slices, and the answer is a link you can send.
            </p>
          </div>
          <Link
            href="/stats/rankings/build/"
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700"
          >
            Open the builder
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-4 space-y-2">
          {PRESETS.map((group) => (
            /* The label sits above its chips on a phone and beside them from small up. In a
               fixed gutter at phone width it strands itself on the first line and the chips
               wrap around it, which reads as a layout that ran out of room. */
            <div
              key={group.group}
              className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-3"
            >
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 sm:w-20 sm:text-xs sm:normal-case sm:tracking-normal sm:text-gray-500 sm:dark:text-gray-400">
                {group.group}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {/* A spread across the groups rather than all of them. This page introduces the
                  idea; the builder itself carries the full set. */}
              {group.items.filter((preset) => preset.featured).map((preset) => (
                <Link
                  key={preset.label}
                  href={`/stats/rankings/build/?${toSearchParams({ ...EMPTY_SLICE, ...preset.slice })}`}
                  className="inline-flex min-h-8 items-center rounded-full border border-gray-200 bg-white px-3 text-xs text-gray-700 transition-colors hover:border-primary-400 hover:text-primary-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-primary-500 dark:hover:text-primary-400"
                >
                  {preset.label}
                </Link>
              ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Link
        href="/browse/?sort=divisiveness&view=ranked"
        className="mb-8 flex items-start gap-3 rounded-xl border border-dashed border-gray-300 p-4 transition-colors hover:border-primary-500 dark:border-gray-600 dark:hover:border-primary-500"
      >
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
          <Search className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-gray-900 dark:text-white">
            Rank your own search
          </span>
          <span className="mt-0.5 block text-sm text-gray-600 dark:text-gray-400">
            For a slice the builder cannot express, Browse filters on nine dimensions at once
            and orders the result by the same measures used here.
          </span>
        </span>
      </Link>

      <div className="mb-4 border-t border-gray-200 pt-6 dark:border-gray-700">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Standing boards</h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
          Questions a slice cannot ask on its own: how far apart the votes are, how a
          reputation moved, where a list stops, how a reader votes against the room.
        </p>
      </div>

      {/* Gated on the same state as the grid below. There is nothing to search or filter when
          the fetch failed, and a toolbar over an error message only offers dead controls. */}
      {loading || catalogue ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search rankings"
              aria-label="Search rankings"
              className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:border-primary-500 focus:ring-1 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400 transition-colors"
            />
            {!query && (
              <kbd className="hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 rounded pointer-events-none">
                /
              </kbd>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter rankings">
            {INTENTS.map((intent) => {
              const count = intentCounts[intent.key] ?? 0;
              const isActive = activeIntent === intent.key;
              return (
                <button
                  key={intent.key}
                  type="button"
                  onClick={() => setActiveIntent(intent.key)}
                  disabled={counted && count === 0 && !isActive}
                  aria-pressed={isActive}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    isActive
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {intent.label}
                  {/* Holds its width empty, so the row does not reflow when the figures land. */}
                  <span
                    className={`ml-1.5 inline-block min-w-4 tabular-nums ${isActive ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'}`}
                  >
                    {counted ? count : ''}
                  </span>
                </button>
              );
            })}

            {isFiltering && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setActiveIntent('all');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl image-placeholder" />
          ))}
        </div>
      ) : !catalogue ? (
        <p className="py-16 text-center text-gray-500 dark:text-gray-400">
          Rankings are unavailable right now. They are rebuilt daily; try again shortly.
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-gray-500 dark:text-gray-400">
          {query ? `No rankings match “${query}”.` : 'No rankings in this group yet.'}
        </p>
      ) : (
        <>
          {/* Outside the grid below: a sticky element can only travel within its own parent,
              and inside that grid its parent would be one short row. */}
          <SectionStrip sections={sectionCounts} />

          <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
            <SectionRail sections={sectionCounts} total={filtered.length} />

            <div className="min-w-0">
              {sections.map(({ section, boards: found }) => (
                <section
                  key={section.key}
                  id={`section-${section.key}`}
                  className="mb-10 scroll-mt-28"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <section.Icon className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                      {section.label}
                    </h2>
                    <span className="text-sm tabular-nums text-gray-400 dark:text-gray-500">
                      {found.length}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{section.blurb}</p>

                  {clusterBoards(section, found).map((cluster) => (
                    <div key={cluster.label || section.key} className="mb-6 last:mb-0">
                      {cluster.label ? (
                        <div className="mb-2.5">
                          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {cluster.label}
                          </h3>
                          {cluster.note ? (
                            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                              {cluster.note}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {cluster.boards.map((board) => (
                          <BoardCard key={board.slug} board={board} />
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </>
      )}

      <StatsCrossLinks current="rankings" />
    </div>
  );
}
