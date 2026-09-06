'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from '@/components/Link';
import { Search } from 'lucide-react';

import { EMPTY_SLICE, PRESETS, toSearchParams } from './build/slice-options';
import { DataFreshness } from '@/components/stats/DataFreshness';
import { JitenAttribution } from '@/components/JitenAttribution';
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
    <div className="st-card st-card--pick group relative flex flex-col p-3.5">
      <div className="flex items-start justify-between gap-2">
        {/* The hover colour sits on the link rather than on the heading: `.st-card-title`
            declares its colour outside every cascade layer, which a utility on the same
            element cannot override, while the link only inherits that colour. */}
        <h4 className="st-card-title">
          <Link
            href={`/stats/rankings/${board.slug}/`}
            className="transition-colors after:absolute after:inset-0 group-hover:text-[color:var(--ai)] group-focus-within:text-[color:var(--ai)]"
          >
            {board.title}
          </Link>
        </h4>
        {onTrends ? (
          <Link
            href="/stats/trends/"
            // Lifted above the title's overlay so this reaches the trends page rather than
            // the board, which is the whole point of showing it.
            className="group/trends relative z-10 -my-1.5 -mr-1 inline-flex min-h-9 shrink-0 items-center px-1"
          >
            <span className="st-badge group-hover/trends:border-[color:var(--kohaku)]">Trends</span>
          </Link>
        ) : board.window !== 'all' ? (
          <span className="st-badge shrink-0">
            {board.window === 'week' ? 'this week' : board.window === 'month' ? 'this month' : board.window}
          </span>
        ) : null}
      </div>

      <p className="st-card-sub mt-1 line-clamp-3">{board.blurb}</p>

      {board.total_ranked > 0 ? (
        <p className="mt-auto pt-2 text-[11px] tabular-nums text-[color:var(--text-faint)]">
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
        <h1 className="sec-title">Rankings</h1>
        <p className="sec-sub max-w-2xl">
          Leaderboards drawn from the whole vote record. Build one over any slice you like,
          or take one of the standing boards below, which answer the questions a slice on its
          own cannot. For what is popular right now, see trends.
        </p>

        <DataFreshness dumpDate={catalogue?.dump_date} className="mt-3" />
      </header>

      {/* The builder leads, because most board questions here are one slice of what it can ask.
          Presets are chips rather than links to pages: landing on one with the controls
          already filled in says the slice can be changed, which a fixed URL does not. */}
      <section className="st-card mb-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-xl">
            <h2 className="sec-title">Build a ranking</h2>
            <p className="sec-sub">
              Pick an era, platform, length, tag, age rating or Japanese difficulty, then rank
              the titles in it or the readers who read them. Worked out when you ask, so there
              is no fixed list of slices, and the answer is a link you can send.
            </p>
          </div>
          <Link
            href="/stats/rankings/build/"
            className="st-act st-act--go min-h-10 shrink-0"
          >
            Open the builder
            <span aria-hidden>&rarr;</span>
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
              <span className="fig-label shrink-0 sm:w-20">{group.group}</span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {/* A spread across the groups rather than all of them. This page introduces the
                  idea; the builder itself carries the full set. */}
              {group.items.filter((preset) => preset.featured).map((preset) => (
                <Link
                  key={preset.label}
                  href={`/stats/rankings/build/?${toSearchParams({ ...EMPTY_SLICE, ...preset.slice })}`}
                  className="st-act min-h-8"
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
        className="st-card st-card--pick mb-8 block p-4"
      >
        <span className="min-w-0">
          <span className="st-card-title block">Rank your own search</span>
          <span className="st-card-sub mt-0.5 block">
            For a slice the builder cannot express, Browse filters on nine dimensions at once
            and orders the result by the same measures used here.
          </span>
        </span>
      </Link>

      <div className="mb-4 border-t border-[color:var(--rule)] pt-6">
        <h2 className="sec-title">Standing boards</h2>
        <p className="sec-sub max-w-2xl">
          Questions a slice cannot ask on its own: how far apart the votes are, how a
          reputation moved, where a list stops, how a reader votes against the room.
        </p>
      </div>

      {/* Gated on the same state as the grid below. There is nothing to search or filter when
          the fetch failed, and a toolbar over an error message only offers dead controls. */}
      {loading || catalogue ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--text-faint)]" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search rankings"
              aria-label="Search rankings"
              className="st-field w-full py-2.5 pl-9 pr-10"
            />
            {!query && (
              <kbd className="hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--text-faint)] border border-[color:var(--rule)] rounded-xs pointer-events-none">
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
                  className={`tab disabled:cursor-not-allowed disabled:opacity-40 ${
                    isActive ? 'tab--on' : ''
                  }`}
                >
                  {intent.label}
                  {/* Holds its width empty, so the row does not reflow when the figures land. */}
                  <span className="tab-count inline-block min-w-4">{counted ? count : ''}</span>
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
                className="st-act"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xs image-placeholder" />
          ))}
        </div>
      ) : !catalogue ? (
        <p className="py-16 text-center text-[color:var(--nezu)]">
          Rankings are unavailable right now. They are rebuilt daily; try again shortly.
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-[color:var(--nezu)]">
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
                  <div className="mb-1 flex items-baseline gap-2">
                    <h2 className="sec-title">{section.label}</h2>
                    <span className="st-num text-sm text-[color:var(--text-faint)]">
                      {found.length}
                    </span>
                  </div>
                  <p className="sec-sub mb-4">{section.blurb}</p>

                  {clusterBoards(section, found).map((cluster) => (
                    <div key={cluster.label || section.key} className="mb-6 last:mb-0">
                      {cluster.label ? (
                        <div className="mb-2.5">
                          <h3 className="fig-label">{cluster.label}</h3>
                          {cluster.note ? (
                            <p className="st-card-sub mt-0.5">{cluster.note}</p>
                          ) : null}
                        </div>
                      ) : null}

                      {/* A board page credits its own source in its header. A listing shows
                          the same measurements as a title and a count without opening one,
                          so the credit belongs beside the cards as well. Driven by what the
                          board declares rather than by its metric name, so a board that
                          starts using an outside source is credited without a second edit. */}
                      {cluster.boards.some((board) => board.attribution) ? (
                        <JitenAttribution className="mb-2.5" />
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
