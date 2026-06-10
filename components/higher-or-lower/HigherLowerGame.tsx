'use client';

import { type ReactNode, useEffect, useReducer, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { vndbStatsApi, type HigherLowerPoolVN } from '@/lib/vndb-stats-api';
import { awaitVNImageDecode } from '@/lib/prefetch-vn-images';
import { useNSFWRevealContext } from '@/lib/nsfw-reveal';
import { VNPanel } from './VNPanel';
import { GameOverCard } from './GameOverCard';
import { METRICS, METRIC_ORDER, type MetricKey } from './metrics';

// Only the per-mode best streaks are persisted, and only locally. No run state, no PII.
const BEST_KEY = 'vn-higher-or-lower';

type Status = 'loading' | 'error' | 'ready' | 'revealing' | 'correct' | 'gameover';
type Bests = Record<MetricKey, number>;

interface State {
  status: Status;
  pool: HigherLowerPoolVN[];
  deck: number[]; // shuffled pool indices; challenger = deck[cursor], anchor = deck[cursor - 1]
  cursor: number;
  mode: MetricKey;
  streak: number;
  bests: Bests;
  guess: 'higher' | 'lower' | null;
  justBest: boolean;
}

type Action =
  | { type: 'LOADED'; pool: HigherLowerPoolVN[] }
  | { type: 'ERROR' }
  | { type: 'SET_BESTS'; bests: Bests }
  | { type: 'SET_MODE'; mode: MetricKey }
  | { type: 'GUESS'; dir: 'higher' | 'lower' }
  | { type: 'REVEAL_DONE' }
  | { type: 'NEXT' }
  | { type: 'RESTART' };

function shuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const initial: State = {
  status: 'loading',
  pool: [],
  deck: [],
  cursor: 1,
  mode: 'votes',
  streak: 0,
  bests: { votes: 0, rating: 0, year: 0 },
  guess: null,
  justBest: false,
};

// Ensure the next challenger differs from the anchor on the active metric, so a
// matchup is never an ambiguous tie (years repeat a lot; votes/rating rarely). If
// nothing in the rest of the deck differs (degenerate pool), the pair is left as is
// and REVEAL_DONE passes the tie.
function ensureDistinctChallenger(deck: number[], cursor: number, pool: HigherLowerPoolVN[], mode: MetricKey): number[] {
  if (cursor < 1 || cursor >= deck.length) return deck;
  const value = METRICS[mode].value;
  const anchorVal = value(pool[deck[cursor - 1]]);
  if (value(pool[deck[cursor]]) !== anchorVal) return deck;
  // Prefer an as-yet-unseen slot ahead; only at the deck's tail fall back to an
  // earlier one (a harmless repeat there) so a tie is never actually presented.
  let target = -1;
  for (let j = cursor + 1; j < deck.length; j++) {
    if (value(pool[deck[j]]) !== anchorVal) {
      target = j;
      break;
    }
  }
  if (target === -1) {
    for (let j = cursor - 2; j >= 0; j--) {
      if (value(pool[deck[j]]) !== anchorVal) {
        target = j;
        break;
      }
    }
  }
  if (target === -1) return deck; // whole pool shares this value (never happens)
  const d = deck.slice();
  [d[cursor], d[target]] = [d[target], d[cursor]];
  return d;
}

// A fresh run: reshuffle, streak 0, ready. Keeps mode and bests.
function freshRun(state: State): State {
  const deck = ensureDistinctChallenger(shuffle(state.pool.length), 1, state.pool, state.mode);
  return { ...state, status: 'ready', deck, cursor: 1, streak: 0, guess: null, justBest: false };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOADED':
      return freshRun({ ...state, pool: action.pool });
    case 'ERROR':
      return { ...state, status: 'error' };
    case 'SET_BESTS':
      return {
        ...state,
        bests: {
          votes: Math.max(state.bests.votes, action.bests.votes || 0),
          rating: Math.max(state.bests.rating, action.bests.rating || 0),
          year: Math.max(state.bests.year, action.bests.year || 0),
        },
      };
    case 'SET_MODE':
      // Switching metric deals a fresh pair, so e.g. switching to Year never reuses a
      // pair whose years you already saw as the subtitle. Clicking the active mode is a
      // no-op.
      if (action.mode === state.mode || state.pool.length < 2) return state;
      return freshRun({ ...state, mode: action.mode });
    case 'GUESS':
      if (state.status !== 'ready') return state;
      return { ...state, status: 'revealing', guess: action.dir };
    case 'REVEAL_DONE': {
      if (state.status !== 'revealing') return state;
      const value = METRICS[state.mode].value;
      const a = value(state.pool[state.deck[state.cursor - 1]]);
      const c = value(state.pool[state.deck[state.cursor]]);
      // Challengers are picked to differ from the anchor (ensureDistinctChallenger),
      // so an exact tie should not occur; if a degenerate pool forces one, it passes.
      const correct = c === a ? true : c > a === (state.guess === 'higher');
      if (!correct) return { ...state, status: 'gameover' };
      const streak = state.streak + 1;
      const prevBest = state.bests[state.mode];
      const bests = streak > prevBest ? { ...state.bests, [state.mode]: streak } : state.bests;
      return { ...state, status: 'correct', streak, bests, justBest: streak > prevBest };
    }
    case 'NEXT': {
      if (state.status !== 'correct') return state;
      let cursor = state.cursor + 1;
      let deck = state.deck;
      if (cursor >= state.deck.length) {
        // Endless: only reachable on an absurd streak. Reshuffle but keep the current
        // anchor at the front so it does not appear twice in a row.
        const anchorIdx = state.deck[state.cursor];
        deck = [anchorIdx, ...shuffle(state.pool.length).filter((i) => i !== anchorIdx)];
        cursor = 1;
      }
      deck = ensureDistinctChallenger(deck, cursor, state.pool, state.mode);
      return { ...state, status: 'ready', deck, cursor, guess: null };
    }
    case 'RESTART':
      return freshRun(state);
    default:
      return state;
  }
}

export default function HigherLowerGame() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [nsfw, setNsfw] = useState(false);
  const [refetching, setRefetching] = useState(false);
  // A mid-run mode switch or covers toggle ends the run, so it asks first: the intended
  // action is parked here until confirmed, and cancel just drops it.
  const [pending, setPending] = useState<{ kind: 'mode'; mode: MetricKey } | { kind: 'nsfw'; value: boolean } | null>(
    null,
  );
  const reveal = useNSFWRevealContext();
  const hydrated = useRef(false);

  // Read stored per-mode bests once after mount (keeps SSR and first render in sync).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      const v = raw ? JSON.parse(raw) : null;
      if (v?.bests) dispatch({ type: 'SET_BESTS', bests: v.bests });
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Persist bests only after hydration so the initial zeros never clobber stored values.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify({ bests: state.bests }));
    } catch {
      // localStorage unavailable
    }
  }, [state.bests]);

  // Flip hydrated AFTER the persist effect's mount run, so that run sees false and
  // skips writing the initial zeros over a stored value.
  useEffect(() => {
    hydrated.current = true;
  }, []);

  // Fetch the pool on mount and whenever the SFW/NSFW choice changes. The board stays
  // mounted during a refetch (just dimmed) so the page does not jump.
  useEffect(() => {
    let active = true;
    setRefetching(true);
    vndbStatsApi
      .getHigherLowerPool(nsfw)
      .then((res) => {
        if (!active) return;
        if (res?.pool?.length >= 2) dispatch({ type: 'LOADED', pool: res.pool });
        else dispatch({ type: 'ERROR' });
      })
      .catch(() => {
        if (active) dispatch({ type: 'ERROR' });
      })
      .finally(() => {
        if (active) setRefetching(false);
      });
    return () => {
      active = false;
    };
  }, [nsfw]);

  // Drive the reveal: hold briefly (the votes count-up runs underneath) then settle.
  useEffect(() => {
    if (state.status !== 'revealing') return;
    const t = setTimeout(() => dispatch({ type: 'REVEAL_DONE' }), 800);
    return () => clearTimeout(t);
  }, [state.status, state.cursor]);

  // Brief pause after a correct guess before the next slides in.
  useEffect(() => {
    if (state.status !== 'correct') return;
    const t = setTimeout(() => dispatch({ type: 'NEXT' }), 850);
    return () => clearTimeout(t);
  }, [state.status, state.cursor]);

  // If the player guesses on instead of answering the confirm, its streak context is
  // stale: drop it.
  useEffect(() => {
    if (state.status !== 'ready') setPending(null);
  }, [state.status]);

  // Decode the round-after-next cover ahead of time so advancing never shows a blank.
  useEffect(() => {
    if (state.status !== 'ready' && state.status !== 'correct') return;
    const next = state.pool[state.deck[state.cursor + 1]];
    if (next?.image_url) {
      awaitVNImageDecode([{ imageUrl: next.image_url, vnId: next.id, imageSexual: next.image_sexual ?? undefined }], 512);
    }
  }, [state.status, state.cursor, state.deck, state.pool]);

  if (state.status === 'loading') {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </Centered>
    );
  }
  if (state.status === 'error') {
    return (
      <Centered>
        <p className="text-sm text-gray-500 dark:text-gray-400">The game is unavailable right now. Please try again later.</p>
      </Centered>
    );
  }

  const anchor = state.pool[state.deck[state.cursor - 1]];
  const challenger = state.pool[state.deck[state.cursor]];
  const challengerPhase = state.status === 'ready' ? 'guess' : state.status === 'revealing' ? 'countup' : 'revealed';
  const verdict = state.status === 'correct' ? 'correct' : state.status === 'gameover' ? 'wrong' : null;
  const locked = state.status === 'revealing' || state.status === 'correct';
  // Only ask for confirmation when there is a run to lose; at streak 0 or game over the
  // switch applies instantly as before.
  const midRun = state.status === 'ready' && state.streak > 0;
  const confirmPending = () => {
    if (!pending) return;
    if (pending.kind === 'mode') dispatch({ type: 'SET_MODE', mode: pending.mode });
    else setNsfw(pending.value);
    setPending(null);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-3 flex justify-center">
        <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-800/50">
          {METRIC_ORDER.map((mk) => {
            const active = state.mode === mk;
            return (
              <button
                key={mk}
                type="button"
                disabled={locked || refetching}
                onClick={() => {
                  if (mk === state.mode) return;
                  if (midRun) setPending({ kind: 'mode', mode: mk });
                  else dispatch({ type: 'SET_MODE', mode: mk });
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
                  active
                    ? 'bg-white text-violet-600 shadow-sm dark:bg-gray-900 dark:text-violet-400'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {METRICS[mk].label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
        <label
          className={`inline-flex items-center gap-2 text-xs font-medium ${
            locked || refetching
              ? 'cursor-not-allowed text-gray-400 dark:text-gray-600'
              : 'cursor-pointer text-gray-600 dark:text-gray-300'
          }`}
        >
          <input
            type="checkbox"
            checked={nsfw}
            disabled={locked || refetching}
            onChange={(e) => {
              // Controlled by nsfw, so while the confirm is pending the box visibly
              // stays put; it only flips once confirmed.
              if (midRun) setPending({ kind: 'nsfw', value: e.target.checked });
              else setNsfw(e.target.checked);
            }}
            className="h-4 w-4 accent-violet-600"
          />
          Enable explicit covers
        </label>
        {nsfw && reveal ? (
          <button
            type="button"
            title="Show or blur adult covers everywhere on the site"
            onClick={() => reveal.setAllRevealed(!reveal.allRevealed)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {reveal.allRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {reveal.allRevealed ? 'Blur covers' : 'Reveal covers'}
          </button>
        ) : null}
      </div>

      <div className="relative">
        <div className="mb-5 flex items-center justify-center gap-8 text-center">
          <Stat label="Streak" value={state.streak} highlight />
          <Stat label="Best" value={state.bests[state.mode]} />
        </div>
        {/* Floats over the stats row (absolute, so the board below never shifts).
            Keep playing is the focused, prominent default; ending the run is the
            quiet one. */}
        {pending ? (
          <div
            role="alertdialog"
            aria-label="End your current run?"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPending(null);
            }}
            className="absolute left-1/2 top-0 z-10 w-full max-w-sm -translate-x-1/2 rounded-2xl border border-gray-200 bg-white p-4 text-center shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            <p className="text-sm font-semibold text-gray-900 dark:text-white">End your current run?</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {pending.kind === 'mode'
                ? `Switching modes starts a new run. Your streak of ${state.streak} will be lost.`
                : `Changing this reloads the pool and starts a new run. Your streak of ${state.streak} will be lost.`}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setPending(null)}
                className="flex-1 rounded-xl bg-violet-600 py-2 text-xs font-semibold text-white transition hover:bg-violet-700"
              >
                Keep playing
              </button>
              <button
                type="button"
                onClick={confirmPending}
                className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/50"
              >
                {pending.kind === 'mode' ? 'Switch and end run' : 'Change and end run'}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* During a SFW/NSFW refetch the board stays mounted (dimmed, with a spinner over
          it) rather than being swapped for a tall spinner, so nothing jumps. */}
      <div className={`relative transition-opacity ${refetching ? 'opacity-50' : ''}`}>
        <div className={`flex items-stretch gap-2 sm:gap-3 ${refetching ? 'pointer-events-none' : ''}`}>
          <VNPanel vn={anchor} metric={state.mode} phase="static" linkable />
          <div className="flex shrink-0 items-center justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-xs font-bold text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
              VS
            </span>
          </div>
          <VNPanel
            vn={challenger}
            metric={state.mode}
            phase={challengerPhase}
            verdict={verdict}
            linkable={state.status === 'gameover'}
            onGuess={(dir) => dispatch({ type: 'GUESS', dir })}
          />
        </div>
        {refetching ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : null}
      </div>

      {state.status === 'gameover' && (
        <GameOverCard streak={state.streak} best={state.bests[state.mode]} isBest={state.justBest} mode={state.mode} onRestart={() => dispatch({ type: 'RESTART' })} />
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <div className={`text-3xl font-extrabold tabular-nums ${highlight ? 'text-violet-600 dark:text-violet-400' : 'text-gray-900 dark:text-white'}`}>{value}</div>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[50vh] items-center justify-center px-4">{children}</div>;
}
