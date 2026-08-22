'use client';

import { useState } from 'react';
import { ChevronDown, ExternalLink, Info } from 'lucide-react';

import { DataFreshness } from '@/components/stats/DataFreshness';
import { describeField } from '@/components/rankings/subject-labels';
import type { Leaderboard } from '@/lib/vndb-stats-api';

/**
 * Title block for a single board.
 *
 * The disclosure is the reason this exists rather than a plain heading. A ranking whose
 * method is not on the page is asking to be taken on trust, and these boards make choices a
 * reader would reasonably want to check: which credits count as making a work, what the
 * minimum sample is, whose votes were left out.
 */

interface BoardHeaderProps {
  board: Leaderboard;
  /**
   * Which heading level the board's title takes. A page whose subject is the board itself
   * leaves this alone; one that names something wider above it passes 'h2', because a second
   * `h1` reads to a screen reader as a second document rather than a section of this one.
   */
  headingLevel?: 'h1' | 'h2';
}

/** The four standing questions, in the order they are worth reading. */
const DISCLOSURE_FIELDS = [
  { key: 'population', label: 'Ranked from' },
  { key: 'floor', label: 'Minimum to qualify' },
  { key: 'score', label: 'Score' },
  { key: 'excluded', label: 'Left out' },
] as const;

export function BoardHeader({ board, headingLevel = 'h1' }: BoardHeaderProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  // Taken from the rows actually delivered rather than a constant, so the figure cannot
  // drift from what is on screen.
  const shown = board.rows.length;
  const disclosure = board.disclosure;
  const hasMethod = !!disclosure || board.notes.length > 0;
  const Heading = headingLevel;

  return (
    <header className="mb-6">
      <Heading className="text-3xl font-bold text-gray-900 dark:text-white">
        {board.title}
      </Heading>

      {board.blurb ? (
        <p className="mt-2 text-gray-600 dark:text-gray-400 max-w-2xl">{board.blurb}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* State the cap rather than the full total on its own: only the top slice is
            stored, so a bare count would suggest there is more to scroll to. */}
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {shown < board.total_ranked
            ? `Top ${shown} of ${describeField(board.subject, board.total_ranked)}`
            : describeField(board.subject, board.total_ranked)}
        </span>
        <DataFreshness dumpDate={board.dump_date} />
      </div>

      {/* Sits with the title rather than inside the methodology panel: the figure being
          ranked comes from elsewhere, so the credit should not need a disclosure opened to find. */}
      {board.attribution ? (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Difficulty data from{' '}
          <a
            href={board.attribution.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline"
          >
            {board.attribution.label}
            <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      ) : null}

      {hasMethod ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setNotesOpen((open) => !open)}
            aria-expanded={notesOpen}
            className="-mx-2 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            <Info className="w-3.5 h-3.5" />
            How this is counted
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${notesOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {notesOpen ? (
            <div className="mt-3 max-w-3xl rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
              {disclosure ? (
                <dl className="grid gap-x-5 gap-y-2.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                  {DISCLOSURE_FIELDS.map(({ key, label }) => (
                    <div key={key} className="contents">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 sm:pt-0.5">
                        {label}
                      </dt>
                      <dd className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                        {disclosure[key]}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {board.notes.length > 0 ? (
                <ul
                  className={`space-y-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400 list-disc list-outside pl-4 ${
                    disclosure ? 'mt-4 pt-4 border-t border-gray-200 dark:border-gray-700' : ''
                  }`}
                >
                  {board.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
