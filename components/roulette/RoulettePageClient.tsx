'use client';

import { useReducer, useCallback, useEffect, useRef, useState } from 'react';
import Link from '@/components/Link';
import { Users, User, RotateCcw, Trash2, Rows3, Grid3X3 } from 'lucide-react';
import { useTitlePreference } from '@/lib/title-preference';
import { useLocale } from '@/lib/i18n/locale-context';
import { rouletteStrings } from '@/lib/i18n/translations/roulette';
import { RouletteWheel } from './RouletteWheel';
import { VNSearchAdd } from './VNSearchAdd';
import { RouletteResult } from './RouletteResult';
import { AssignmentHistory } from './AssignmentHistory';

// ── Types ──

export interface WheelEntry {
  id: string;
  title: string;
  title_jp?: string;
  title_romaji?: string;
  imageUrl?: string | null;
  imageSexual?: number | null;
  rating?: number | null;
}

export interface Assignment {
  player: string;
  vn: WheelEntry;
  round: number;
}

export type SpinState = 'idle' | 'spinning' | 'result';

interface RouletteState {
  mode: 'solo' | 'users';
  entries: WheelEntry[];
  players: string[];
  remainingPlayers: string[];
  currentPlayer: string | null;
  spinState: SpinState;
  winnerIndex: number | null;
  result: WheelEntry | null;
  assignments: Assignment[];
  round: number;
  removeOnPick: boolean;
  playerOrder: 'random' | 'sequential';
}

// ── Reducer ──

type Action =
  | { type: 'ADD_ENTRY'; entry: WheelEntry }
  | { type: 'REMOVE_ENTRY'; id: string }
  | { type: 'ADD_PLAYER'; name: string }
  | { type: 'REMOVE_PLAYER'; name: string }
  | { type: 'SET_MODE'; mode: 'solo' | 'users' }
  | { type: 'START_SPIN' }
  | { type: 'FINISH_SPIN' }
  | { type: 'DISMISS_RESULT' }
  | { type: 'RESET_ASSIGNMENTS' }
  | { type: 'CLEAR_ENTRIES' }
  | { type: 'TOGGLE_REMOVE_ON_PICK' }
  | { type: 'TOGGLE_PLAYER_ORDER' }
  | { type: 'RESTORE'; state: RouletteState };

const MAX_ENTRIES = 15;
const MAX_PLAYERS = 15;
const STORAGE_KEY = 'vn-roulette-state';

function reducer(state: RouletteState, action: Action): RouletteState {
  switch (action.type) {
    case 'RESTORE': {
      return action.state;
    }
    case 'ADD_ENTRY': {
      if (state.entries.length >= MAX_ENTRIES) return state;
      if (state.entries.some(e => e.id === action.entry.id)) return state;
      return { ...state, entries: [...state.entries, action.entry] };
    }
    case 'REMOVE_ENTRY': {
      return { ...state, entries: state.entries.filter(e => e.id !== action.id) };
    }
    case 'ADD_PLAYER': {
      const name = action.name.trim();
      if (!name || state.players.length >= MAX_PLAYERS) return state;
      if (state.players.some(p => p.toLowerCase() === name.toLowerCase())) return state;
      return {
        ...state,
        players: [...state.players, name],
        remainingPlayers: [...state.remainingPlayers, name],
      };
    }
    case 'REMOVE_PLAYER': {
      return {
        ...state,
        players: state.players.filter(p => p !== action.name),
        remainingPlayers: state.remainingPlayers.filter(p => p !== action.name),
      };
    }
    case 'SET_MODE': {
      return {
        ...state,
        mode: action.mode,
        spinState: 'idle',
        result: null,
        winnerIndex: null,
        currentPlayer: null,
      };
    }
    case 'START_SPIN': {
      const winnerIndex = Math.floor(Math.random() * state.entries.length);
      let currentPlayer: string | null = null;
      if (state.mode === 'users' && state.remainingPlayers.length > 0) {
        if (state.playerOrder === 'sequential') {
          currentPlayer = state.remainingPlayers[0];
        } else {
          const playerIndex = Math.floor(Math.random() * state.remainingPlayers.length);
          currentPlayer = state.remainingPlayers[playerIndex];
        }
      }
      return {
        ...state,
        spinState: 'spinning',
        winnerIndex,
        currentPlayer,
        result: null,
      };
    }
    case 'FINISH_SPIN': {
      if (state.winnerIndex === null) return state;
      const result = state.entries[state.winnerIndex];
      const newAssignments = state.mode === 'users' && state.currentPlayer
        ? [...state.assignments, { player: state.currentPlayer, vn: result, round: state.round + 1 }]
        : state.assignments;
      const newRemaining = state.mode === 'users' && state.currentPlayer
        ? state.remainingPlayers.filter(p => p !== state.currentPlayer)
        : state.remainingPlayers;
      const newEntries = state.removeOnPick
        ? state.entries.filter(e => e.id !== result.id)
        : state.entries;
      return {
        ...state,
        entries: newEntries,
        spinState: 'result',
        result,
        assignments: newAssignments,
        remainingPlayers: newRemaining,
        round: state.mode === 'users' ? state.round + 1 : state.round,
      };
    }
    case 'DISMISS_RESULT': {
      return {
        ...state,
        spinState: 'idle',
        result: null,
        winnerIndex: null,
        currentPlayer: null,
      };
    }
    case 'RESET_ASSIGNMENTS': {
      return {
        ...state,
        assignments: [],
        remainingPlayers: [...state.players],
        round: 0,
        spinState: 'idle',
        result: null,
        winnerIndex: null,
        currentPlayer: null,
      };
    }
    case 'CLEAR_ENTRIES': {
      return {
        ...state,
        entries: [],
        spinState: 'idle',
        result: null,
        winnerIndex: null,
      };
    }
    case 'TOGGLE_REMOVE_ON_PICK': {
      return { ...state, removeOnPick: !state.removeOnPick };
    }
    case 'TOGGLE_PLAYER_ORDER': {
      return { ...state, playerOrder: state.playerOrder === 'random' ? 'sequential' : 'random' };
    }
    default:
      return state;
  }
}

const initialState: RouletteState = {
  mode: 'solo',
  entries: [],
  players: [],
  remainingPlayers: [],
  currentPlayer: null,
  spinState: 'idle',
  winnerIndex: null,
  result: null,
  assignments: [],
  round: 0,
  removeOnPick: false,
  playerOrder: 'random',
};

// ── Component ──

// Stored state is read after mount, never during render: the server has no access to
// localStorage, so a saved wheel used as the initial state would not match the markup
// the server sent.
function readStoredState(): RouletteState | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return {
      ...initialState,
      mode: parsed.mode || 'solo',
      entries: parsed.entries || [],
      players: parsed.players || [],
      remainingPlayers: parsed.remainingPlayers || parsed.players || [],
      assignments: parsed.assignments || [],
      round: parsed.round || 0,
      removeOnPick: parsed.removeOnPick || false,
      playerOrder: parsed.playerOrder || 'random',
    };
  } catch { /* ignore */ }
  return null;
}

export default function RoulettePageClient() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { preference, setPreference } = useTitlePreference();
  const locale = useLocale();
  const s = rouletteStrings[locale];
  const [isHydrated, setIsHydrated] = useState(false);
  const playerInputRef = useRef<HTMLInputElement>(null);

  // The restore and the flag land in one commit, so the persist effect below cannot
  // overwrite the saved wheel with the empty one before it has been read.
  useEffect(() => {
    const stored = readStoredState();
    if (stored) dispatch({ type: 'RESTORE', state: stored });
    setIsHydrated(true);
  }, []);

  // Persist to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode: state.mode,
        entries: state.entries,
        players: state.players,
        remainingPlayers: state.remainingPlayers,
        assignments: state.assignments,
        round: state.round,
        removeOnPick: state.removeOnPick,
        playerOrder: state.playerOrder,
      }));
    } catch { /* ignore */ }
  }, [isHydrated, state.mode, state.entries, state.players, state.remainingPlayers, state.assignments, state.round, state.removeOnPick, state.playerOrder]);

  const handleAddEntry = useCallback((entry: WheelEntry) => {
    dispatch({ type: 'ADD_ENTRY', entry });
  }, []);

  const handleRemoveEntry = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_ENTRY', id });
  }, []);

  const handleSpin = useCallback(() => {
    if (state.entries.length < 2) return;
    if (state.spinState === 'spinning') return;
    if (state.mode === 'users' && state.remainingPlayers.length === 0) return;
    dispatch({ type: 'START_SPIN' });
  }, [state.entries.length, state.spinState, state.mode, state.remainingPlayers.length]);

  const handleSpinComplete = useCallback(() => {
    dispatch({ type: 'FINISH_SPIN' });
  }, []);

  const handleDismissResult = useCallback(() => {
    dispatch({ type: 'DISMISS_RESULT' });
  }, []);

  const handleAddPlayer = useCallback((name: string) => {
    dispatch({ type: 'ADD_PLAYER', name });
  }, []);

  const handleRemovePlayer = useCallback((name: string) => {
    dispatch({ type: 'REMOVE_PLAYER', name });
  }, []);

  const handlePlayerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = playerInputRef.current;
      if (input && input.value.trim()) {
        handleAddPlayer(input.value);
        input.value = '';
      }
    }
  };

  const handleAddPlayerClick = () => {
    const input = playerInputRef.current;
    if (input && input.value.trim()) {
      handleAddPlayer(input.value);
      input.value = '';
      input.focus();
    }
  };

  // Auto-assign when exactly 1 player and 1 entry remain in group mode
  const lastPairAutoAssign = state.mode === 'users'
    && state.remainingPlayers.length === 1
    && state.entries.length === 1
    && state.spinState === 'idle';

  const handleAutoAssign = useCallback(() => {
    if (!lastPairAutoAssign) return;
    dispatch({ type: 'START_SPIN' });
    // Immediately finish since the outcome is predetermined
    setTimeout(() => dispatch({ type: 'FINISH_SPIN' }), 0);
  }, [lastPairAutoAssign]);

  const canSpin = state.entries.length >= 2
    && state.spinState !== 'spinning'
    && (state.mode === 'solo' || state.remainingPlayers.length > 0);

  const allAssigned = state.mode === 'users' && state.remainingPlayers.length === 0 && state.players.length > 0;

  return (
    <div className="min-h-[80vh] px-4 py-8 md:py-12">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="sec-title">{s['page.title']}</h1>
          <p className="sec-sub max-w-md mx-auto">{s['page.subtitle']}</p>
          <Link
            href={locale === 'en' ? '/ja/roulette/' : '/roulette/'}
            className="toy-btn mt-4"
            onClick={() => setPreference(locale === 'en' ? 'japanese' : 'romaji')}
          >
            {locale === 'en' ? '日本語' : 'English'}
          </Link>

          {/* Mode toggle, on its own row. The language link above is inline, and a segmented
              control placed beside it reads as a third segment of the same control. */}
          <div className="mt-4 flex justify-center">
          <div className="rc-seg">
            <button
              onClick={() => dispatch({ type: 'SET_MODE', mode: 'solo' })}
              className={`rc-seg-item gap-1.5 ${state.mode === 'solo' ? 'rc-seg-item--on' : ''}`}
            >
              <User className="w-3.5 h-3.5" />
              {s['mode.solo']}
            </button>
            <button
              onClick={() => dispatch({ type: 'SET_MODE', mode: 'users' })}
              className={`rc-seg-item gap-1.5 ${state.mode === 'users' ? 'rc-seg-item--on' : ''}`}
            >
              <Users className="w-3.5 h-3.5" />
              {s['mode.group']}
            </button>
          </div>
          </div>

          <div className="flex flex-col items-center gap-1.5 mt-3">
            <label className="toy-check-row">
              <input
                type="checkbox"
                checked={state.removeOnPick}
                onChange={() => dispatch({ type: 'TOGGLE_REMOVE_ON_PICK' })}
                className="bw-check"
              />
              <span>{s['settings.removeOnPick']}</span>
            </label>
            {state.mode === 'users' && (
              <label className="toy-check-row">
                <input
                  type="checkbox"
                  checked={state.playerOrder === 'sequential'}
                  onChange={() => dispatch({ type: 'TOGGLE_PLAYER_ORDER' })}
                  className="bw-check"
                />
                <span>{s['settings.playerOrder']}</span>
              </label>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="flex max-lg:flex-col lg:flex-row gap-4 lg:gap-5">
          {/* Left sidebar */}
          <div className="max-lg:w-full lg:w-56 shrink-0 space-y-3">
            {/* VN Search */}
            <div>
              <h2 className="toy-label mb-2 block">
                {s['sidebar.vnCount'].replace('{count}', String(state.entries.length)).replace('{max}', String(MAX_ENTRIES))}
              </h2>
              <VNSearchAdd
                onAdd={handleAddEntry}
                isItemInList={useCallback((id: string) => state.entries.some(e => e.id === id), [state.entries])}
                isAtCapacity={state.entries.length >= MAX_ENTRIES}
                disabled={state.spinState === 'spinning'}
                placeholder={state.entries.length >= MAX_ENTRIES ? s['sidebar.searchCapacity'] : s['sidebar.searchPlaceholder']}
                addedLabel={s['sidebar.added']}
                errorMessage={s['sidebar.searchError']}
              />
            </div>

            {/* Entry list */}
            {state.entries.length > 0 && (
              <div className="toy-panel overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  {state.entries.map((entry, i) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      index={i}
                      onRemove={handleRemoveEntry}
                      disabled={state.spinState === 'spinning'}
                      preference={preference}
                    />
                  ))}
                </div>
                {state.entries.length > 0 && (
                  <div className="border-t border-[color:var(--rule)] p-1.5">
                    <button
                      onClick={() => dispatch({ type: 'CLEAR_ENTRIES' })}
                      disabled={state.spinState === 'spinning'}
                      className="toy-cmd toy-cmd--drop"
                    >
                      {s['sidebar.clearAll']}
                    </button>
                  </div>
                )}
              </div>
            )}

            {state.entries.length === 0 && (
              <p className="text-xs text-[color:var(--nezu)] text-center py-4">
                {s['sidebar.emptyHint']}
              </p>
            )}
          </div>

          {/* Center: Wheel */}
          <div className="flex-1 flex flex-col items-center">
            <div className="relative w-full flex flex-col items-center">
              <RouletteWheel
                entries={state.entries}
                spinState={state.spinState}
                winnerIndex={state.winnerIndex}
                onSpinComplete={handleSpinComplete}
                titlePreference={preference}
                emptyText={s['wheel.emptyText']}
              />

              {/* Result overlay on top of wheel */}
              {state.spinState === 'result' && state.result && (
                <div className="absolute inset-0 flex items-center justify-center z-10">
                  <RouletteResult
                    result={state.result}
                    currentPlayer={state.currentPlayer}
                    mode={state.mode}
                    onDismiss={handleDismissResult}
                    hasMorePlayers={state.remainingPlayers.length > 0}
                    allAssigned={allAssigned}
                  />
                </div>
              )}
            </div>

            {/* Current player indicator (users mode, during spin) */}
            {state.mode === 'users' && state.currentPlayer && state.spinState === 'spinning' && (
              <div className="mt-4 text-center animate-fade-in">
                <span className="text-sm text-[color:var(--nezu)]">{s['spin.spinningFor']} </span>
                <span className="font-mono text-sm font-medium text-[color:var(--kohaku-text)]">{state.currentPlayer}</span>
              </div>
            )}

            {/* Spin button or auto-assign */}
            {state.spinState !== 'result' && (
              lastPairAutoAssign ? (
                <button
                  onClick={handleAutoAssign}
                  className="toy-btn toy-btn--go toy-btn--wide mt-6"
                >
                  {s['spin.assignLast']}
                </button>
              ) : (
                <button
                  onClick={handleSpin}
                  disabled={!canSpin}
                  className="toy-btn toy-btn--go toy-btn--wide mt-6"
                >
                  {state.spinState === 'spinning' ? s['spin.spinning'] : s['spin.button']}
                </button>
              )
            )}

            {/* All assigned message */}
            {allAssigned && state.spinState === 'idle' && (
              <div className="mt-6 text-center">
                <p className="mb-2 text-sm font-medium text-[color:var(--ai)]">{s['result.allAssigned']}</p>
                <button
                  onClick={() => dispatch({ type: 'RESET_ASSIGNMENTS' })}
                  className="toy-btn"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {s['result.resetAndGoAgain']}
                </button>
              </div>
            )}
          </div>

          {/* Right sidebar: Player queue (users mode only) */}
          {state.mode === 'users' && (
            <div className="max-lg:w-full lg:w-52 shrink-0">
              <h2 className="toy-label mb-2 block">
                {s['players.title'].replace('{remaining}', String(state.remainingPlayers.length)).replace('{total}', String(state.players.length))}
              </h2>

              {/* Add player input */}
              <div className="flex gap-2 mb-3">
                <input
                  ref={playerInputRef}
                  type="text"
                  placeholder={s['players.addPlaceholder']}
                  onKeyDown={handlePlayerKeyDown}
                  disabled={state.spinState === 'spinning' || state.players.length >= MAX_PLAYERS}
                  className="toy-field flex-1 min-w-0"
                />
                <button
                  onClick={handleAddPlayerClick}
                  disabled={state.spinState === 'spinning' || state.players.length >= MAX_PLAYERS}
                  className="toy-btn toy-btn--go"
                >
                  {s['players.addButton']}
                </button>
              </div>

              {/* Player list */}
              {state.players.length > 0 && (
                <div className="toy-panel overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    {state.players.map(player => {
                      const isRemaining = state.remainingPlayers.includes(player);
                      const isCurrent = state.currentPlayer === player;
                      return (
                        <div
                          key={player}
                          className={`toy-row ${isCurrent ? 'toy-row--now' : !isRemaining ? 'toy-row--spent' : ''}`}
                        >
                          <div className={`toy-dot ${isCurrent ? 'toy-dot--now' : isRemaining ? 'toy-dot--on' : ''}`} />
                          <span className={`flex-1 min-w-0 truncate ${!isRemaining ? 'line-through' : ''}`}>
                            {player}
                          </span>
                          <button
                            onClick={() => handleRemovePlayer(player)}
                            disabled={state.spinState === 'spinning'}
                            className="toy-x"
                            aria-label={`Remove ${player}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {state.assignments.length > 0 && (
                    <div className="border-t border-[color:var(--rule)] p-1.5">
                      <button
                        onClick={() => dispatch({ type: 'RESET_ASSIGNMENTS' })}
                        disabled={state.spinState === 'spinning'}
                        className="toy-cmd"
                      >
                        {s['players.resetAssignments']}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {state.players.length === 0 && (
                <p className="text-xs text-[color:var(--nezu)] text-center py-4">
                  {s['players.emptyHint']}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Assignment history */}
        {state.mode === 'users' && state.assignments.length > 0 && (
          <AssignmentHistory
            assignments={state.assignments}
            onReset={() => dispatch({ type: 'RESET_ASSIGNMENTS' })}
            titlePreference={preference}
          />
        )}

        <div className="mt-6 flex justify-center gap-4">
          <Link
            href={locale === 'ja' ? '/ja/tierlist/' : '/tierlist/'}
            className="toy-btn"
          >
            <Rows3 className="w-4 h-4" />
            {s['crosslink.tryTierList']}
          </Link>
          <Link
            href={locale === 'ja' ? '/ja/3x3-maker/' : '/3x3-maker/'}
            className="toy-btn"
          >
            <Grid3X3 className="w-4 h-4" />
            {s['crosslink.try3x3']}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Entry row ──

import { getDisplayTitle, type TitlePreference } from '@/lib/title-preference';
import { getTinySrc } from '@/lib/vndb-image-cache';
import { NSFW_THRESHOLD } from '@/lib/nsfw-reveal';

// Kept in step with the wheel: an entry row names the wedge its title sits on, so the
// two lists have to read as one.
const WHEEL_COLORS = [
  '#235C66', '#3C4046', '#9C6D10', '#A62432', '#2E6E5E',
  '#17181A', '#4A5A6B', '#7A4A1E', '#1C4A53', '#5A5F66',
];

function EntryRow({ entry, index, onRemove, disabled, preference }: {
  entry: WheelEntry;
  index: number;
  onRemove: (id: string) => void;
  disabled: boolean;
  preference: TitlePreference;
}) {
  const color = WHEEL_COLORS[index % WHEEL_COLORS.length];
  const title = getDisplayTitle(entry, preference);
  const isNsfw = entry.imageSexual != null && entry.imageSexual >= NSFW_THRESHOLD;
  const coverSrc = entry.imageUrl ? (isNsfw ? getTinySrc(entry.imageUrl) : entry.imageUrl) : null;

  return (
    <div className="toy-row">
      <div className="w-1 h-6 shrink-0 mt-0.5" style={{ backgroundColor: color }} />
      {coverSrc && (
        <div className="toy-thumb w-6 h-8">
          <img src={coverSrc} alt="" className="w-full h-full object-cover" style={isNsfw ? { imageRendering: 'pixelated' } : undefined} />
        </div>
      )}
      <span className="flex-1 min-w-0 break-words">
        {title}
      </span>
      <button
        onClick={() => onRemove(entry.id)}
        disabled={disabled}
        className="toy-x"
        aria-label={`Remove ${title}`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
